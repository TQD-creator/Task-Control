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

function isoInMinutes(minutes) {
  return new Date(Date.now() + minutes * 60000).toISOString();
}

// --- Leisure Loan tuning (borrow play now, repay as forced focus) ----------
// A strict commitment device: leisure is priced and gated, never open-ended.
// All knobs live here so the gate/scaling is easy to tune.
const LOAN_MIN_STREAK = 3; // days of "good behavior" needed to unlock at all
const LOAN_CONSISTENT_STREAK = 7; // days that raise the cap and grant a 2nd daily use
const LOAN_BASE_MAX_MINUTES = 20; // borrow cap below the consistency threshold
const LOAN_BOOST_MAX_MINUTES = 30; // borrow cap once consistent
const LOAN_INTEREST = 1.25; // repay = ceil(borrowed * interest), paid as forced focus
const LOAN_PREP_MINUTES = 5; // max "get your tools ready" window before repayment

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
      // Fire OS reminders for tasks due today / overdue (see reminderService).
      notifications_enabled: true,
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
    // hand-editable. reason: 'manual' (user toggled "Go Unga Bunga"),
    // 'penalty' (a dopamine-chasing overrun forced it), or 'leisure_loan' (a
    // Leisure Loan repayment). A penalty lock releases the next day; a
    // leisure_loan lock releases at expires_at (see normalizeProfile). task_id
    // null = still needs a pick.
    focus_lock: { active: false, task_id: null, reason: null, locked_on: null, expires_at: null },
    // Leisure Loan: borrow play time now, repay as forced focus (1.25x) after.
    // Computed state — don't hand-edit. `active` holds an in-progress loan; the
    // per-day counters reset on a new day (see normalizeLeisureLoan).
    leisure_loan: { date: null, uses_today: 0, active: null },
    big_vague_goals: [],
  };
}

// Backfill any keys a profile written by an older app version is missing, and
// auto-resolve a stale penalty lock. Runs on every load so the "next day"
// release of a penalty lock needs no background timer — the day the streak
// date would advance, the lock is simply cleared here.
function normalizeProfile(profile) {
  if (!profile.focus_lock || typeof profile.focus_lock !== 'object') {
    profile.focus_lock = { active: false, task_id: null, reason: null, locked_on: null, expires_at: null };
  } else if (profile.focus_lock.expires_at === undefined) {
    // Backfill the timed-lock field on locks written before Leisure Loan.
    profile.focus_lock.expires_at = null;
  }
  // Backfill the reminders flag for profiles written before Theme 4 landed;
  // default on so existing users start getting due/overdue nudges.
  if (profile.personalization && profile.personalization.notifications_enabled === undefined) {
    profile.personalization.notifications_enabled = true;
  }
  const lock = profile.focus_lock;
  if (lock.active && lock.reason === 'penalty' && lock.locked_on && lock.locked_on < today()) {
    profile.focus_lock = { active: false, task_id: null, reason: null, locked_on: null, expires_at: null };
  }
  normalizeLeisureLoan(profile);
  return profile;
}

function ensureLeisureLoan(profile) {
  if (!profile.leisure_loan || typeof profile.leisure_loan !== 'object') {
    profile.leisure_loan = { date: null, uses_today: 0, active: null };
  }
  return profile.leisure_loan;
}

// Runs on every load. Three jobs, all keyed off wall-clock timestamps so no
// background timer is needed (mirrors the penalty-lock day-clear above):
//   1. Daily reset  — the per-day use counter rolls over on a new day.
//   2. Escape-proof — a play/prep window that fully elapsed with the app closed
//      arms the repayment lock on reopen, so quitting can't dodge the debt.
//   3. Timed release — an expired leisure_loan lock is cleared and finalized.
function normalizeLeisureLoan(profile) {
  const loan = ensureLeisureLoan(profile);
  const now = nowIso();

  if (loan.date && loan.date < today()) {
    loan.uses_today = 0;
    loan.date = today();
  }

  const active = loan.active;
  if (active && active.phase !== 'repay') {
    const windowEnd = active.phase === 'prep' ? active.prep_ends_at : active.play_ends_at;
    if (windowEnd && windowEnd <= now) {
      active.phase = 'repay';
      const expiresAt = isoInMinutes(active.repay_minutes);
      active.repay_ends_at = expiresAt;
      setFocusLock(profile, active.task_id ?? null, 'leisure_loan', expiresAt);
    }
  }

  const lock = profile.focus_lock;
  if (lock && lock.active && lock.reason === 'leisure_loan' && lock.expires_at && lock.expires_at <= now) {
    finishLeisureLoan(profile);
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

// ATOMIC write, same pattern as db/database.js writeNow(). A plain in-place
// writeFileSync truncates the file first, so an interrupted write — or a reader
// that lands mid-write — sees half a JSON document. rename() is atomic on the
// same filesystem, so the profile on disk is always either the old one or the
// new one, never a fragment.
function saveProfile(profilePath, profile) {
  profile.updated_at = nowIso();
  const tmp = `${profilePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(profile, null, 2));
  fs.renameSync(tmp, profilePath);
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

function setNotificationsEnabled(profile, enabled) {
  profile.personalization.notifications_enabled = !!enabled;
  return profile;
}

// reason: 'manual' (Go Unga Bunga toggle) | 'penalty' (dopamine overrun) |
// 'leisure_loan' (repayment of borrowed play). taskId null means "locked but no
// task chosen yet" -> the UI shows the picker. expiresAt (ISO) time-boxes the
// lock — only set for 'leisure_loan'; null locks stay until manually cleared or
// the next-day penalty sweep.
function setFocusLock(profile, taskId = null, reason = 'manual', expiresAt = null) {
  profile.focus_lock = {
    active: true,
    task_id: taskId ?? null,
    reason,
    locked_on: today(),
    expires_at: expiresAt ?? null,
  };
  return profile;
}

function clearFocusLock(profile) {
  profile.focus_lock = { active: false, task_id: null, reason: null, locked_on: null, expires_at: null };
  return profile;
}

// ---------------------------------------------------------------------------
// Leisure Loan: borrow play time now, repay as forced focus (1.25x) after
// ---------------------------------------------------------------------------

// Pure read for the UI: whether the user may borrow right now, and the current
// limits. Gated on the streak ("good behavior"); the cap and daily max scale up
// once the streak is "consistent".
function leisureLoanStatus(profile) {
  const streak = profile.streaks?.current_streak_days || 0;
  const consistent = streak >= LOAN_CONSISTENT_STREAK;
  const capMinutes = consistent ? LOAN_BOOST_MAX_MINUTES : LOAN_BASE_MAX_MINUTES;
  const maxUses = consistent ? 2 : 1;
  const loan = profile.leisure_loan || { date: null, uses_today: 0, active: null };
  const usesToday = loan.date === today() ? loan.uses_today || 0 : 0;
  const lockActive = !!profile.focus_lock?.active;

  let eligible = true;
  let reason = null;
  if (streak < LOAN_MIN_STREAK) { eligible = false; reason = 'streak'; }
  else if (loan.active) { eligible = false; reason = 'in_progress'; }
  else if (lockActive) { eligible = false; reason = 'locked'; }
  else if (usesToday >= maxUses) { eligible = false; reason = 'used_up'; }

  return {
    eligible,
    reason,
    streak,
    min_streak: LOAN_MIN_STREAK,
    consistent_streak: LOAN_CONSISTENT_STREAK,
    cap_minutes: capMinutes,
    max_uses: maxUses,
    uses_today: usesToday,
    interest: LOAN_INTEREST,
    prep_minutes: LOAN_PREP_MINUTES,
    active: loan.active || null,
  };
}

// Open a loan: hand over `minutes` of sanctioned play (phase 'play', counts
// down to play_ends_at) and record the repayment owed. Refuses when not
// eligible. Returns { ok, reason?, profile }.
function startLeisureLoan(profile, { minutes, taskId = null } = {}) {
  ensureLeisureLoan(profile);
  const status = leisureLoanStatus(profile);
  if (!status.eligible) return { ok: false, reason: status.reason, profile };

  const n = Math.max(1, Math.min(Math.floor(minutes || 0), status.cap_minutes));
  const repayMinutes = Math.ceil(n * LOAN_INTEREST);
  const startedAt = nowIso();

  if (profile.leisure_loan.date !== today()) {
    profile.leisure_loan.date = today();
    profile.leisure_loan.uses_today = 0;
  }
  profile.leisure_loan.date = today();
  profile.leisure_loan.uses_today += 1;
  profile.leisure_loan.active = {
    phase: 'play',
    task_id: taskId ?? null,
    borrowed_minutes: n,
    started_at: startedAt,
    play_ends_at: isoInMinutes(n),
    prep_ends_at: null,
    repay_minutes: repayMinutes,
    repay_ends_at: null,
  };
  profile.time_economy.ledger.push({
    date: startedAt,
    task_id: taskId ?? null,
    type: 'leisure_loan',
    event: 'borrow',
    borrowed_minutes: n,
    repay_minutes: repayMinutes,
  });
  return { ok: true, profile };
}

// Play -> prep: the "get your tools ready" buffer (capped at LOAN_PREP_MINUTES).
function beginLeisurePrep(profile) {
  const loan = profile.leisure_loan?.active;
  if (!loan || loan.phase !== 'play') return { ok: false, profile };
  loan.phase = 'prep';
  loan.prep_ends_at = isoInMinutes(LOAN_PREP_MINUTES);
  return { ok: true, profile };
}

// -> repay: arm the timed focus lock for the repayment window. Callable from
// play (skip prep) or prep. The lock takes over the whole app until expires_at.
function beginLeisureRepay(profile) {
  const loan = profile.leisure_loan?.active;
  if (!loan || loan.phase === 'repay') return { ok: false, profile };
  loan.phase = 'repay';
  const expiresAt = isoInMinutes(loan.repay_minutes);
  loan.repay_ends_at = expiresAt;
  setFocusLock(profile, loan.task_id ?? null, 'leisure_loan', expiresAt);
  return { ok: true, profile };
}

// Close out a loan: log the repayment and release the lock (only if it's the
// leisure_loan lock). Called when the repay clock expires, on the load-time
// sweep, or when the repaid task is completed early.
function finishLeisureLoan(profile) {
  const loan = profile.leisure_loan?.active;
  if (loan) {
    profile.time_economy.ledger.push({
      date: nowIso(),
      task_id: loan.task_id ?? null,
      type: 'leisure_loan',
      event: 'repaid',
      borrowed_minutes: loan.borrowed_minutes,
      repay_minutes: loan.repay_minutes,
    });
    profile.leisure_loan.active = null;
  }
  if (profile.focus_lock?.reason === 'leisure_loan') {
    clearFocusLock(profile);
  }
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
  setNotificationsEnabled,
  setFocusLock,
  clearFocusLock,
  logBoredom,
  logPunishment,
  servePunishment,
  leisureLoanStatus,
  startLeisureLoan,
  beginLeisurePrep,
  beginLeisureRepay,
  finishLeisureLoan,
};
