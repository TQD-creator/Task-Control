// Pure state machine for follow-ups — the loose ends a task leaves behind
// (submit it; email someone and wait for a reply). No DB, no Electron: every
// function takes a plain follow-up row and returns a field patch, so the whole
// thing is unit-testable. database.js persists the patch; reminderService fires
// the nudges; the in-app inbox collects the answers.
//
// kinds:  'submit' | 'notify_wait' | 'custom'
// states: 'pending' -> ('awaiting_reply' for notify_wait) -> 'resolved'
// answers: 'done' | 'sent' | 'replied' | 'not_yet'

function nowIso(now = new Date()) {
  return now.toISOString();
}

function addMinutesIso(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

// The in-app question for a follow-up, given its kind + current state. A
// notify_wait asks a different thing before vs. after you've sent it.
function questionFor(followUp) {
  switch (followUp.kind) {
    case 'notify_wait':
      return followUp.state === 'awaiting_reply'
        ? followUp.question || 'Have they replied yet?'
        : 'Have you sent it?';
    case 'submit':
      return followUp.question || 'Did you submit it?';
    default:
      return followUp.question || 'Done?';
  }
}

// The action buttons the inbox should show for a follow-up.
function actionsFor(followUp) {
  if (followUp.kind === 'notify_wait') {
    return followUp.state === 'awaiting_reply'
      ? [{ answer: 'replied', label: 'Replied' }, { answer: 'not_yet', label: 'Not yet' }]
      : [{ answer: 'sent', label: 'Sent' }, { answer: 'not_yet', label: 'Not yet' }];
  }
  return [
    { answer: 'done', label: followUp.kind === 'submit' ? 'Submitted' : 'Done' },
    { answer: 'not_yet', label: 'Not yet' },
  ];
}

// Apply a user answer -> a DB field patch (only the columns that change). `now`
// is injectable for tests. An unexpected answer for the current state is a no-op.
function applyAnswer(followUp, answer, now = new Date()) {
  const iso = nowIso(now);
  const resolve = () => ({ state: 'resolved', resolved_at: iso, next_nudge_at: null });
  const snooze = () => ({ next_nudge_at: addMinutesIso(iso, followUp.repeat_minutes || 120) });

  if (answer === 'not_yet') return snooze();

  if (followUp.kind === 'notify_wait') {
    if (followUp.state === 'pending' && answer === 'sent') {
      // Sent — now wait for the reply, and keep nudging on the same cadence.
      return { state: 'awaiting_reply', next_nudge_at: addMinutesIso(iso, followUp.repeat_minutes || 120) };
    }
    if (followUp.state === 'awaiting_reply' && answer === 'replied') return resolve();
    return {};
  }

  // submit / custom
  if (answer === 'done') return resolve();
  return {};
}

// When a freshly-created follow-up should first nudge. notify_wait reminds you
// to send it right away; a submit with a due date waits until the due-day
// morning; everything else nudges now.
function initialNudgeAt({ kind, dueDate }, now = new Date()) {
  const iso = nowIso(now);
  if (kind === 'notify_wait') return iso;
  if (kind === 'submit' && dueDate) return `${dueDate}T09:00:00.000Z`;
  return iso;
}

module.exports = { questionFor, actionsFor, applyAnswer, initialNudgeAt, addMinutesIso };
