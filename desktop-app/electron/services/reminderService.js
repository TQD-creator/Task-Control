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

let timer = null;
let db = null;
let isEnabled = () => true;
let onActivate = () => {};
let notifiedIds = new Set();
let notifiedDate = null;
let intervalMs = 30 * 60 * 1000;

function today() {
  return new Date().toISOString().slice(0, 10);
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

// deps: { db, isEnabled(): boolean, onActivate(): void, intervalMs? }
function start(deps) {
  db = deps.db;
  if (typeof deps.isEnabled === 'function') isEnabled = deps.isEnabled;
  if (typeof deps.onActivate === 'function') onActivate = deps.onActivate;
  if (deps.intervalMs) intervalMs = deps.intervalMs;

  stop();
  // First check a few seconds after launch so it doesn't race window creation.
  setTimeout(check, 5000);
  timer = setInterval(check, intervalMs);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, check };
