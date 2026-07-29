// Personalization Engine: reads/writes user_profile.json (schema in
// user_profile.schema.json) and owns the Time Debt / Guilt-Free Bank math
// that runs whenever a task is completed.

import * as FileSystem from 'expo-file-system';

const PROFILE_PATH = `${FileSystem.documentDirectory}user_profile.json`;

function nowIso() {
  return new Date().toISOString();
}

function today() {
  return nowIso().slice(0, 10);
}

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function defaultProfile() {
  const timestamp = nowIso();
  return {
    user_id: generateId(),
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
    personalization: {
      tone_preference: 'encouraging',
      work_hours: { start: '09:00', end: '18:00' },
      peak_energy_windows: [],
      risk_tolerance: 'medium',
    },
    time_economy: {
      time_debt_minutes: 0,
      guilt_free_bank_minutes: 0,
      ledger: [],
    },
    estimation_calibration: {
      low_effort_low_impact: { sample_count: 0, avg_actual_to_estimate_ratio: 1.0 },
      low_effort_high_impact: { sample_count: 0, avg_actual_to_estimate_ratio: 1.0 },
      high_effort_low_impact: { sample_count: 0, avg_actual_to_estimate_ratio: 1.0 },
      high_effort_high_impact: { sample_count: 0, avg_actual_to_estimate_ratio: 1.0 },
    },
    streaks: {
      current_streak_days: 0,
      longest_streak_days: 0,
      last_completed_date: null,
    },
    big_vague_goals: [],
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function loadProfile() {
  const info = await FileSystem.getInfoAsync(PROFILE_PATH);
  if (!info.exists) {
    const fresh = defaultProfile();
    await saveProfile(fresh);
    return fresh;
  }
  const raw = await FileSystem.readAsStringAsync(PROFILE_PATH);
  return JSON.parse(raw);
}

export async function saveProfile(profile) {
  profile.updated_at = nowIso();
  await FileSystem.writeAsStringAsync(PROFILE_PATH, JSON.stringify(profile, null, 2));
  return profile;
}

// ---------------------------------------------------------------------------
// Time Debt / Guilt-Free Bank
// A completed task that ran long adds to time_debt_minutes (owed time); one
// that finished early adds the saved minutes to guilt_free_bank_minutes
// (spendable, no-guilt rest). Both are logged to the ledger for later display
// and for injection into the LLM system prompt (Step 4).
// ---------------------------------------------------------------------------

function bucketKey(effort, impact) {
  return `${effort}_effort_${impact}_impact`;
}

function updateCalibration(profile, effort, impact, estimatedMinutes, actualMinutes) {
  if (!estimatedMinutes || estimatedMinutes <= 0) return;
  const key = bucketKey(effort, impact);
  const bucket = profile.estimation_calibration[key] ?? { sample_count: 0, avg_actual_to_estimate_ratio: 1.0 };
  const ratio = actualMinutes / estimatedMinutes;
  const newCount = bucket.sample_count + 1;
  const newAvg = (bucket.avg_actual_to_estimate_ratio * bucket.sample_count + ratio) / newCount;
  profile.estimation_calibration[key] = { sample_count: newCount, avg_actual_to_estimate_ratio: newAvg };
}

function updateStreak(profile) {
  const { last_completed_date, current_streak_days, longest_streak_days } = profile.streaks;
  const todayStr = today();

  if (last_completed_date === todayStr) {
    // Already logged a completion today; streak doesn't change.
    return;
  }

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const newStreak = last_completed_date === yesterdayStr ? current_streak_days + 1 : 1;

  profile.streaks.current_streak_days = newStreak;
  profile.streaks.longest_streak_days = Math.max(longest_streak_days, newStreak);
  profile.streaks.last_completed_date = todayStr;
}

// Call after db.completeTask(). Mutates and returns the profile; caller is
// responsible for saveProfile(profile) (batched so the caller can also await
// the DB write in the same transaction boundary).
export function recordTaskCompletion(profile, task, { justification = null } = {}) {
  const { id: taskId, effort, impact, estimated_minutes: estimatedMinutes, actual_minutes: actualMinutes } = task;
  const delta = actualMinutes - estimatedMinutes;

  if (delta > 0) {
    profile.time_economy.time_debt_minutes += delta;
    profile.time_economy.ledger.push({
      date: nowIso(),
      task_id: taskId,
      type: 'debt',
      delta_minutes: delta,
      justification: justification ?? undefined,
    });
  } else if (delta < 0) {
    const saved = -delta;
    profile.time_economy.guilt_free_bank_minutes += saved;
    profile.time_economy.ledger.push({
      date: nowIso(),
      task_id: taskId,
      type: 'bank',
      delta_minutes: saved,
    });
  }

  updateCalibration(profile, effort, impact, estimatedMinutes, actualMinutes);
  updateStreak(profile);

  return profile;
}

// Explicit debt repayment (e.g. user logs "caught up" time outside a task).
export function repayTimeDebt(profile, minutes, note = null) {
  const repay = Math.min(minutes, profile.time_economy.time_debt_minutes);
  profile.time_economy.time_debt_minutes -= repay;
  profile.time_economy.ledger.push({
    date: nowIso(),
    task_id: null,
    type: 'debt_repayment',
    delta_minutes: -repay,
    justification: note ?? undefined,
  });
  return profile;
}

// Spend banked minutes on guilt-free rest.
export function spendGuiltFreeBank(profile, minutes, note = null) {
  const spend = Math.min(minutes, profile.time_economy.guilt_free_bank_minutes);
  profile.time_economy.guilt_free_bank_minutes -= spend;
  profile.time_economy.ledger.push({
    date: nowIso(),
    task_id: null,
    type: 'bank',
    delta_minutes: -spend,
    justification: note ?? undefined,
  });
  return profile;
}

export function addBigVagueGoal(profile, goalId, text) {
  profile.big_vague_goals.push({ goal_id: goalId, text, created_at: nowIso() });
  return profile;
}
