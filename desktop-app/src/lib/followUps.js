// Renderer-side mirror of the pure bits of electron/services/followUpEngine.js
// (the renderer can't require a main-process module). Keeps the inbox's question
// text and action buttons in sync with the engine's state machine. Answers are
// applied main-side via window.api.followups.answer.

export function questionFor(followUp) {
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

export function actionsFor(followUp) {
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

export const KIND_LABELS = {
  submit: 'Submit',
  notify_wait: 'Notify & wait',
  custom: 'Follow-up',
};
