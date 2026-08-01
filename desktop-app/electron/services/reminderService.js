// Due / overdue task reminders. The app already stores scheduled_date and
// due_date on every task but nothing ever acted on them — this fires an OS
// notification for tasks that are due today or past and still open.
//
// Design notes:
//  - Runs in the main process (only it can raise a native Notification and owns
//    the DB). Profile-agnostic beyond an injected `isEnabled()` gate so the user
//    can turn reminders off (personalization.notifications_enabled).
//  - De-dupes per day: a given task notifies at most once per calendar day. The
//    notified-id set is in-memory and reset when the local date rolls over, so a
//    task still open the next day nudges again.
//  - Coarse cadence (default 30 min) plus the date-rollover reset inside each
//    check is enough; no separate midnight timer is needed.

const { Notification } = require('electron');
const followUpEngine = require('./followUpEngine');

let timer = null;
let db = null;
let isEnabled = () => true;
let isLocked = () => false;
let onActivate = () => {};
let onFollowUpActivate = () => {};
let onChoreActivate = () => {};
let notifiedIds = new Set();
let notifiedDate = null;
let notifiedChoreIds = new Set();
let notifiedChoreDate = null;
let intervalMs = 5 * 60 * 1000;

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Local wall-clock 'HH:MM' — chore time_of_day is entered in local time.
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// One reminder pass. Safe to call ad hoc (e.g. right after boot).
function check() {
  const todayStr = today();
  // New day → forget yesterday's notifications so still-open tasks re-nudge.
  if (notifiedDate !== todayStr) {
    notifiedIds = new Set();
    notifiedDate = todayStr;
  }
  if (!isEnabled() || !Notification.isSupported()) return;
  // A focus lock (Lock In / Leisure Loan) means one-thing-only — don't nag.
  if (isLocked()) return;

  const due = db.getDueTasks(todayStr);
  const fresh = due.filter((t) => !notifiedIds.has(t.id));
  if (fresh.length === 0) return;

  for (const t of fresh) notifiedIds.add(t.id);

  const overdue = fresh.filter((t) => (t.scheduled_date || t.due_date) < todayStr).length;
  const titlePreview = fresh.slice(0, 3).map((t) => `• ${t.title}`).join('\n');
  const more = fresh.length > 3 ? `\n…and ${fresh.length - 3} more` : '';

  const n = new Notification({
    title:
      overdue > 0
        ? `${fresh.length} task${fresh.length > 1 ? 's' : ''} due (${overdue} overdue)`
        : `${fresh.length} task${fresh.length > 1 ? 's' : ''} due today`,
    body: titlePreview + more,
    silent: false,
  });
  n.on('click', () => onActivate());
  n.show();
}

// Fire nudges for follow-ups whose time has come. Deferred entirely while a
// focus lock is active — and crucially we DON'T advance next_nudge_at when
// deferring, so the same items resume the instant the lock clears. Fired items
// are pushed out by their own repeat_minutes so they nudge on cadence, not every
// pass. The click routes to the in-app Follow-ups inbox (where answers happen).
function checkFollowUps() {
  if (!isEnabled() || !Notification.isSupported()) return;
  if (isLocked()) return;

  const nowIso = new Date().toISOString();
  const due = db.getDueFollowUps(nowIso);
  if (due.length === 0) return;

  const preview = due.slice(0, 3).map((f) => `• ${f.label}`).join('\n');
  const more = due.length > 3 ? `\n…and ${due.length - 3} more` : '';
  const n = new Notification({
    title: `${due.length} follow-up${due.length > 1 ? 's' : ''} need you`,
    body: preview + more,
    silent: false,
  });
  n.on('click', () => onFollowUpActivate());
  n.show();

  for (const f of due) {
    db.updateFollowUp(f.id, {
      next_nudge_at: followUpEngine.addMinutesIso(nowIso, f.repeat_minutes || 120),
    });
  }
}

// Fire nudges for chores due now (daily not-done-today, or a one-off whose date
// arrived). Same per-day de-dupe + focus-lock deferral as the task pass. Click
// opens the Chores manager. Time-of-day gating is handled in db.getDueChores.
function checkChores() {
  const todayStr = today();
  if (notifiedChoreDate !== todayStr) {
    notifiedChoreIds = new Set();
    notifiedChoreDate = todayStr;
  }
  if (!isEnabled() || !Notification.isSupported()) return;
  if (isLocked()) return;

  const due = db.getDueChores(todayStr, nowHHMM());
  const fresh = due.filter((c) => !notifiedChoreIds.has(c.id));
  if (fresh.length === 0) return;
  for (const c of fresh) notifiedChoreIds.add(c.id);

  const preview = fresh.slice(0, 3).map((c) => `• ${c.title}`).join('\n');
  const more = fresh.length > 3 ? `\n…and ${fresh.length - 3} more` : '';
  const n = new Notification({
    title: `${fresh.length} chore${fresh.length > 1 ? 's' : ''} due`,
    body: preview + more,
    silent: false,
  });
  n.on('click', () => onChoreActivate());
  n.show();
}

// The full pass driven by the loop: due tasks + follow-ups + chores.
function tick() {
  check();
  checkFollowUps();
  checkChores();
}

// deps: { db, isEnabled(), isLocked(), onActivate(), onFollowUpActivate(),
//         onChoreActivate(), intervalMs? }
function start(deps) {
  db = deps.db;
  if (typeof deps.isEnabled === 'function') isEnabled = deps.isEnabled;
  if (typeof deps.isLocked === 'function') isLocked = deps.isLocked;
  if (typeof deps.onActivate === 'function') onActivate = deps.onActivate;
  if (typeof deps.onFollowUpActivate === 'function') onFollowUpActivate = deps.onFollowUpActivate;
  else if (typeof deps.onActivate === 'function') onFollowUpActivate = deps.onActivate;
  if (typeof deps.onChoreActivate === 'function') onChoreActivate = deps.onChoreActivate;
  else if (typeof deps.onActivate === 'function') onChoreActivate = deps.onActivate;
  if (deps.intervalMs) intervalMs = deps.intervalMs;

  stop();
  // First pass a few seconds after launch so it doesn't race window creation.
  setTimeout(tick, 5000);
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, check, checkFollowUps, checkChores, tick };
