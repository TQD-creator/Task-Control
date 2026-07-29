// Electron main-process port of the React Native profileEngine.js. Same
// Time Debt / Guilt-Free Bank math and calibration/streak logic; only the
// persistence (expo-file-system -> node:fs) changed.

const fs = require('fs');

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
    // Computed UI state for the single-task lockdown (Unga Bunga mode). Not
    // hand-editable. reason: 'manual' (user toggled "Go Unga Bunga") or
    // 'penalty' (a dopamine-chasing overrun forced it); a penalty lock releases
    // on the next day (see normalizeProfile). task_id null = still needs a pick.
    focus_lock: { active: false, task_id: null, reason: null, locked_on: null },
    big_vague_goals: [],
  };
}

// Backfill any keys a profile written by an older app version is missing, and
// auto-resolve a stale penalty lock. Runs on every load so the "next day"
// release of a penalty lock needs no background timer — the day the streak
// date would advance, the lock is simply cleared here.
function normalizeProfile(profile) {
  if (!profile.focus_lock || typeof profile.focus_lock !== 'object') {
    profile.focus_lock = { active: false, task_id: null, reason: null, locked_on: null };
  }
  const lock = profile.focus_lock;
  if (lock.active && lock.reason === 'penalty' && lock.locked_on && lock.locked_on < today()) {
    profile.focus_lock = { active: false, task_id: null, reason: null, locked_on: null };
  }
  return profile;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadProfile(profilePath) {
  if (!fs.existsSync(profilePath)) {
    const fresh = defaultProfile();
    saveProfile(profilePath, fresh);
    return fresh;
  }
  const raw = fs.readFileSync(profilePath, 'utf-8');
  return normalizeProfile(JSON.parse(raw));
}

function saveProfile(profilePath, profile) {
  profile.updated_at = nowIso();
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  return profile;
}

// ---------------------------------------------------------------------------
// Time Debt / Guilt-Free Bank
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

  if (last_completed_date === todayStr) return;

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const newStreak = last_completed_date === yesterdayStr ? current_streak_days + 1 : 1;

  profile.streaks.current_streak_days = newStreak;
  profile.streaks.longest_streak_days = Math.max(longest_streak_days, newStreak);
  profile.streaks.last_completed_date = todayStr;
}

// Normalize a justification arg into { note, defense_mechanism }. The
// encouraging path still passes a plain string (or null); the Unga Bunga Time
// Debt modal passes { defense_mechanism, note }.
function parseJustification(justification) {
  if (justification == null) return { note: null, defense_mechanism: null };
  if (typeof justification === 'string') return { note: justification || null, defense_mechanism: null };
  return {
    note: justification.note || null,
    defense_mechanism: justification.defense_mechanism || null,
  };
}

// Mutates the profile (caller persists via saveProfile) and returns
// { profile, penaltyPending }. penaltyPending is true when an overrun in Unga
// Bunga tone named a defense mechanism — the renderer owes the user a
// punishment and pops the punishment menu (see src/lib/punishments.js). The
// lock is no longer applied here automatically; it's just the harshest option
// on that menu, chosen (or not) by the user and served via servePunishment.
function recordTaskCompletion(profile, task, { justification = null } = {}) {
  const { id: taskId, effort, impact, estimated_minutes: estimatedMinutes, actual_minutes: actualMinutes } = task;
  const delta = actualMinutes - estimatedMinutes;
  const ungaBunga = profile.personalization?.tone_preference === 'unga_bunga';
  const { note, defense_mechanism } = parseJustification(justification);

  // Any defense-mechanism overrun in Unga Bunga tone owes a punishment.
  const penaltyPending = ungaBunga && delta > 0 && !!defense_mechanism;

  if (delta > 0) {
    profile.time_economy.time_debt_minutes += delta;
    profile.time_economy.ledger.push({
      date: nowIso(),
      task_id: taskId,
      type: 'debt',
      delta_minutes: delta,
      justification: note ?? undefined,
      defense_mechanism: defense_mechanism ?? undefined,
    });
  } else if (delta < 0) {
    const saved = -delta;
    // Reward inversion (Unga Bunga): the Guilt-Free Bank is locked — it would
    // just serve as an excuse to slack. The streak (below) is the only reward;
    // consistency is the proof of rewrite. We still log the under-run so the
    // ledger stays a complete record, but nothing is banked.
    if (!ungaBunga) {
      profile.time_economy.guilt_free_bank_minutes += saved;
    }
    profile.time_economy.ledger.push({
      date: nowIso(),
      task_id: taskId,
      type: ungaBunga ? 'bank_locked' : 'bank',
      delta_minutes: saved,
    });
  }

  updateCalibration(profile, effort, impact, estimatedMinutes, actualMinutes);
  updateStreak(profile);

  return { profile, penaltyPending };
}

function repayTimeDebt(profile, minutes, note = null) {
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

function spendGuiltFreeBank(profile, minutes, note = null) {
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

function addBigVagueGoal(profile, goalId, text) {
  profile.big_vague_goals.push({ goal_id: goalId, text, created_at: nowIso() });
  return profile;
}

// ---------------------------------------------------------------------------
// Unga Bunga mode: tone, single-task lock, boredom-tanking
// ---------------------------------------------------------------------------

function setTone(profile, tone) {
  profile.personalization.tone_preference = tone;
  return profile;
}

// reason: 'manual' (Go Unga Bunga toggle) | 'penalty' (dopamine overrun).
// taskId null means "locked but no task chosen yet" -> the UI shows the picker.
function setFocusLock(profile, taskId = null, reason = 'manual') {
  profile.focus_lock = {
    active: true,
    task_id: taskId ?? null,
    reason,
    locked_on: today(),
  };
  return profile;
}

function clearFocusLock(profile) {
  profile.focus_lock = { active: false, task_id: null, reason: null, locked_on: null };
  return profile;
}

// Log a "Tanking Boredom" resistance session — time spent deliberately sitting
// with the urge to escape instead of acting on it. Recorded so the ledger maps
// which "demons" pull you away and proves you sat through them.
function logBoredom(profile, durationSeconds) {
  const seconds = Math.max(0, Math.floor(durationSeconds));
  if (seconds <= 0) return profile;
  profile.time_economy.ledger.push({
    date: nowIso(),
    task_id: null,
    type: 'boredom_tank',
    duration_seconds: seconds,
  });
  return profile;
}

// Log a chosen punishment (from the post-overrun punishment menu) to the
// ledger. Categories: 'exercise' | 'social' | 'no_device' | 'money' | 'lock'.
// The record maps not just which demons pull you away (the defense mechanism on
// the debt entry) but what you paid to answer for them.
function logPunishment(profile, punishment) {
  if (!punishment) return profile;
  profile.time_economy.ledger.push({
    date: nowIso(),
    task_id: punishment.task_id ?? null,
    type: 'punishment',
    category: punishment.category,
    punishment_id: punishment.id,
    label: punishment.label,
    duration_minutes: punishment.duration_minutes ?? undefined,
  });
  return profile;
}

// Serve one punishment: always log it; the harshest option ('lock') additionally
// arms the single-task penalty lock until tomorrow. Non-lock punishments are
// self-reported (the renderer confirms they were served) — 'no_device' also
// drives the Tanking Boredom timer, but the lock is the only enforced penalty.
function servePunishment(profile, punishment) {
  logPunishment(profile, punishment);
  if (punishment && punishment.category === 'lock') {
    setFocusLock(profile, null, 'penalty');
  }
  return profile;
}

module.exports = {
  loadProfile,
  saveProfile,
  normalizeProfile,
  recordTaskCompletion,
  repayTimeDebt,
  spendGuiltFreeBank,
  addBigVagueGoal,
  setTone,
  setFocusLock,
  clearFocusLock,
  logBoredom,
  logPunishment,
  servePunishment,
};
