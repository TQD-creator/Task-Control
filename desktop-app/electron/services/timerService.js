// The Milestone & Task Timer's authoritative state manager.
//
// WHY THIS LIVES IN THE MAIN PROCESS (not a renderer Zustand store):
// the floating widget is a SEPARATE, always-on-top BrowserWindow. A store in
// one renderer can't see — let alone pause — a task being timed from another
// window. The one thing the whole app shares is the main process, so the
// single-active-timer rule and the crash-safe persistence have to be enforced
// here. The renderer keeps a thin store that just mirrors the snapshots this
// service broadcasts.
//
// The three CRITICAL constraints from the spec are all satisfied here:
//   1. Single active timer — play() commits + stops whatever else was running
//      before starting the new task, so only one task is ever `running`.
//   2. Persistence not tied to unmount — a 5-second interval folds elapsed
//      seconds into tasks.total_seconds while running, so an abrupt close loses
//      at most ~5s rather than the whole session.
//   3. session -> total on pause/close — pause() does a final flush, so by the
//      time a task stops, its full session has been added to total_seconds.

const db = require('../db/database');

const FLUSH_INTERVAL_MS = 5000;

// broadcast(snapshot) is injected by main.js so this module doesn't depend on
// Electron directly (keeps it unit-testable with a stub). reportBoredom(seconds)
// is likewise injected: this module doesn't know about the profile/ledger, so a
// finished boredom-tank session is handed back to main.js to log.
let broadcast = () => {};
let reportBoredom = () => {};

const state = {
  milestoneId: null, // which milestone the widget is currently showing
  activeTaskId: null, // the single globally-active (timed) task, or null
  mode: 'idle', // 'idle' | 'task' (timing a task) | 'boredom' (tanking boredom)
  running: false, // play/pause (task mode only)
  startedAt: null, // epoch ms the current run segment began (null when paused)
  boredomStartedAt: null, // epoch ms the current boredom session began
  baseTotalSeconds: 0, // active task's total_seconds captured at play() time
  lastSessionSeconds: 0, // length of the last session, for display while paused
};

let flushTimer = null;
let flushedThisSession = 0; // seconds already written to DB for the current run
let boredomAccumSeconds = 0; // clamped seconds tanked in the current boredom session
let lastFlushAt = null; // epoch ms of the previous credit, for sleep/clock-jump clamping

function init({ onBroadcast, onBoredomEnd } = {}) {
  if (onBroadcast) broadcast = onBroadcast;
  if (onBoredomEnd) reportBoredom = onBoredomEnd;
}

// Live seconds elapsed in the current run. While paused it holds the last
// session's length so the widget's "Session" display doesn't snap to zero.
function liveSessionSeconds() {
  if (!state.running || !state.startedAt) return state.lastSessionSeconds;
  return (Date.now() - state.startedAt) / 1000;
}

// The shape sent to every window. The widget computes its own per-second
// display from startedAt/baseTotalSeconds, so this only needs to change when
// the timer is started/paused/switched — not every tick.
function snapshot() {
  return {
    milestoneId: state.milestoneId,
    activeTaskId: state.activeTaskId,
    mode: state.mode,
    running: state.running,
    startedAt: state.startedAt,
    boredomStartedAt: state.boredomStartedAt,
    baseTotalSeconds: state.baseTotalSeconds,
    lastSessionSeconds: Math.floor(state.lastSessionSeconds),
  };
}

function emit() {
  broadcast(snapshot());
}

// Credit the not-yet-persisted whole seconds of the current run into the task's
// total. Computing the delta from flushedThisSession keeps the periodic flush
// and the final pause flush from double-counting.
//
// SLEEP / CLOCK-JUMP CLAMP: liveSessionSeconds() is wall-clock (Date.now()), so
// a laptop sleep or an NTP/DST/manual clock change would otherwise dump the
// entire gap into total_seconds as "worked" time. We never credit more than the
// real time that actually elapsed since the last credit (+1s slack); a larger
// jump is treated as a gap and dropped.
function creditElapsed() {
  const now = Date.now();
  const rawWhole = Math.floor((now - state.startedAt) / 1000);
  const sinceLast = lastFlushAt != null ? Math.ceil((now - lastFlushAt) / 1000) + 1 : rawWhole;
  const cappedWhole = Math.min(rawWhole, flushedThisSession + Math.max(0, sinceLast));
  const delta = cappedWhole - flushedThisSession;
  if (delta > 0) {
    db.addTaskTime(state.activeTaskId, delta);
    flushedThisSession += delta;
  }
  lastFlushAt = now;
}

// The periodic (5s) flush. Also SELF-HEALS: if the active task was deleted or
// completed from another window, the module-state activeTaskId would otherwise
// keep counting a phantom row (deleted -> 0-row UPDATEs; completed -> time
// piling onto a done task, plus a double-render in the widget). Detect it and
// stop the clock cleanly instead.
function flushToDb() {
  if (!state.running || !state.activeTaskId) return;
  const task = db.getTaskById(state.activeTaskId);
  if (!task || task.status === 'completed') {
    stopFlushLoop();
    state.running = false;
    state.startedAt = null;
    state.lastSessionSeconds = flushedThisSession;
    flushedThisSession = 0;
    lastFlushAt = null;
    if (!task) state.activeTaskId = null; // deleted: drop it; completed: keep for context
    emit();
    return;
  }
  creditElapsed();
}

// Boredom counterpart of creditElapsed: accumulate clamped whole seconds of the
// current boredom session into boredomAccumSeconds. Same sleep/clock-jump guard
// so a laptop sleep can't inflate a "resistance" session either.
function creditBoredom() {
  const now = Date.now();
  const rawWhole = Math.floor((now - state.boredomStartedAt) / 1000);
  const sinceLast = lastFlushAt != null ? Math.ceil((now - lastFlushAt) / 1000) + 1 : rawWhole;
  const cappedWhole = Math.min(rawWhole, boredomAccumSeconds + Math.max(0, sinceLast));
  const delta = cappedWhole - boredomAccumSeconds;
  if (delta > 0) boredomAccumSeconds += delta;
  lastFlushAt = now;
}

// The single flush loop drives whichever mode is active.
function flushTick() {
  if (state.mode === 'boredom') creditBoredom();
  else flushToDb();
}

// End the current boredom session: credit the final segment, tear the loop down,
// hand the credited seconds to main.js to log, and return to idle.
function endBoredom() {
  if (state.mode !== 'boredom') return 0;
  creditBoredom();
  stopFlushLoop();
  const credited = boredomAccumSeconds;
  boredomAccumSeconds = 0;
  lastFlushAt = null;
  state.mode = 'idle';
  state.boredomStartedAt = null;
  reportBoredom(credited);
  return credited;
}

function startFlushLoop() {
  stopFlushLoop();
  flushTimer = setInterval(flushTick, FLUSH_INTERVAL_MS);
  // Don't let this timer keep the process alive on its own during shutdown.
  if (flushTimer.unref) flushTimer.unref();
}

function stopFlushLoop() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

// Fold the remaining session into the DB and stop the clock, without clearing
// which task is active (so a paused task can be resumed). try/finally guarantees
// the flush loop is torn down even if the final credit write throws.
function commitActive() {
  try {
    if (state.running && state.activeTaskId) creditElapsed();
  } finally {
    stopFlushLoop();
    // Report the seconds we actually credited (post-clamp), not raw wall time,
    // so the "last session" display can't inherit a sleep-inflated value.
    state.lastSessionSeconds = flushedThisSession;
    state.running = false;
    state.mode = 'idle';
    state.startedAt = null;
    flushedThisSession = 0;
    lastFlushAt = null;
  }
}

// Start (or resume) timing a task. Enforces the single-active-timer rule:
// anything currently running is committed and stopped first.
function play(taskId) {
  const task = db.getTaskById(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);

  // Already actively timing this exact task — nothing to do.
  if (state.running && state.activeTaskId === taskId) return snapshot();

  // Starting a task ends any boredom-tanking session (single-active extends to
  // boredom: you can't tank boredom and time a task at once). The tanked time is
  // logged via reportBoredom before the task clock starts.
  if (state.mode === 'boredom') endBoredom();

  // Single active timer: save & stop whatever was running before switching.
  if (state.running) commitActive();

  state.activeTaskId = taskId;
  state.milestoneId = task.milestone_id;
  state.mode = 'task';
  state.baseTotalSeconds = task.total_seconds || 0; // re-read: includes prior sessions
  state.lastSessionSeconds = 0;
  state.running = true;
  state.startedAt = Date.now();
  flushedThisSession = 0;
  lastFlushAt = Date.now();
  startFlushLoop();
  emit();
  return snapshot();
}

// Start "Tanking Boredom": time deliberate resistance (sitting still, not
// escaping) instead of a task. Stops any running task first (single-active).
function startBoredom() {
  if (state.mode === 'boredom') return snapshot();
  if (state.running) commitActive();
  state.mode = 'boredom';
  state.boredomStartedAt = Date.now();
  boredomAccumSeconds = 0;
  lastFlushAt = Date.now();
  startFlushLoop();
  emit();
  return snapshot();
}

// Stop the boredom session (logs it via reportBoredom inside endBoredom).
function stopBoredom() {
  if (state.mode !== 'boredom') return snapshot();
  endBoredom();
  emit();
  return snapshot();
}

// Pause the active task, flushing its session into total_seconds.
function pause() {
  if (!state.running) return snapshot();
  commitActive();
  emit();
  return snapshot();
}

// The widget points at a milestone; remember it so a reopened widget restores
// the right context even if nothing is currently being timed.
function setMilestone(milestoneId) {
  state.milestoneId = milestoneId;
  emit();
  return snapshot();
}

function getState() {
  return snapshot();
}

// Called when the widget window closes (spec req 3: a closed tab commits its
// session). Safe to call whether or not anything is running.
function handleWidgetClosed() {
  if (state.mode === 'boredom') endBoredom();
  if (state.running) commitActive();
  emit();
}

module.exports = {
  init,
  play,
  pause,
  startBoredom,
  stopBoredom,
  setMilestone,
  getState,
  handleWidgetClosed,
};
