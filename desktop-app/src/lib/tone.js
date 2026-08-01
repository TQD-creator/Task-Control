// Single source of tone-dependent UI copy.
//
// The app has two tones (personalization.tone_preference):
//   'encouraging' — the default: soft, supportive language.
//   'unga_bunga'  — strips the encouragement. When you try to delay a task or
//                   bail on the timer, it names the defense mechanism instead of
//                   asking nicely. Built for an avoidant profile where soft
//                   language is just another exit.
//
// Keeping the strings here (rather than inline in components) means the two
// tones stay in sync and the widget/main window can't drift apart.

export const UNGA_BUNGA = 'unga_bunga';

export function isUngaBunga(tone) {
  return tone === UNGA_BUNGA;
}

const COPY = {
  encouraging: {
    pauseHeading: 'Pause the timer?',
    pauseBody: 'Taking a break is fine. Your time so far is saved.',
    closeHeading: 'Close the timer?',
    closeBody: "Your progress is saved. You can reopen it whenever you're ready.",
    standSteady: 'Keep going',
    surrender: 'Pause anyway',
    surrenderClose: 'Close anyway',
    debtHeading: 'You ran over your estimate',
    debtBody: 'A quick note helps future estimates. What happened?',
    debtSubmit: 'Add to Time Debt',
    boredom: 'Tanking Boredom',
    leisureHeading: 'Borrow some play time',
    leisureBody: "Take a break now — you'll repay it as focused work right after, plus a little interest.",
    leisurePlayHeading: 'Enjoy your break',
    leisurePrepHeading: 'Get your tools ready',
    leisureStart: 'Start focus now',
    prepHeading: 'Get ready',
    prepBody: 'A few minutes setting up now makes starting easy. Gather what you need and note where you left off.',
  },
  unga_bunga: {
    pauseHeading: 'Stand steady.',
    pauseBody:
      'Your brain is making you feel tired right now to force you to surrender. Stand steady.',
    closeHeading: 'Stand steady.',
    closeBody:
      'Your brain is making you feel tired right now to force you to surrender. Stand steady.',
    standSteady: 'Stand steady',
    surrender: 'Surrender anyway',
    surrenderClose: 'Surrender anyway',
    debtHeading: 'Which demon won?',
    debtBody:
      'This overrun was a defense mechanism, not bad luck. Name the direction your mind went — so you can map exactly which demons pull you away.',
    debtSubmit: 'Log it',
    boredom: 'Tanking Boredom',
    leisureHeading: 'Take the advance. The bill comes due.',
    leisureBody:
      'Play now if you must — but you will repay every borrowed minute as forced focus, with interest. There is no escape once the clock starts.',
    leisurePlayHeading: 'Your borrowed time',
    leisurePrepHeading: 'Prepare. The lock is coming.',
    leisureStart: 'Face the work',
    prepHeading: 'Prepare to execute',
    prepBody: 'Clear the runway. Get every tool in front of you so there is no excuse to stall when you start.',
  },
};

// copy(tone, key) — falls back to the encouraging string for any unknown tone.
export function copy(tone, key) {
  const table = COPY[tone] || COPY.encouraging;
  return table[key] ?? COPY.encouraging[key] ?? '';
}

// The "Direction of Mind" defense mechanisms shown by the Time Debt modal in
// Unga Bunga tone. The `dopamine` choice is what triggers the penalty lockdown
// (see profileEngine.recordTaskCompletion).
export const DEFENSE_MECHANISMS = [
  { value: 'dopamine', label: 'I chased short-term dopamine (games, scrolling).' },
  { value: 'over_complicate', label: 'I over-complicated the task to avoid finishing it.' },
  { value: 'hope_panic', label: 'A ray of hope made me panic and shut down.' },
];
