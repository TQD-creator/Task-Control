// The punishment menu shown after a defense-mechanism overrun in Unga Bunga
// tone (any of the three "Direction of Mind" picks, on an over-estimate).
//
// A completion that names a demon owes a price. The menu offers FOUR options:
// three randomly-drawn punishments — one each from three of the four categories
// below — plus the harsh `lock` as a guaranteed final-straw option. The user
// must pick exactly one; there is no walking away clean.
//
// Non-lock punishments are self-reported (the user confirms they served them)
// and logged to `time_economy.ledger`. The `no_device` punishment additionally
// drives the Tanking Boredom timer for its set minutes. Only the `lock` option
// is app-enforced — it arms the single-task penalty lock until tomorrow.

const CATEGORIES = [
  {
    category: 'exercise',
    category_label: 'Exercise',
    icon: '💪',
    options: [
      '20 push-ups. Right now, before anything else.',
      '50 body-weight squats.',
      'Hold a plank for 2 minutes.',
      '15 burpees.',
      'Walk hard for 10 minutes.',
    ],
  },
  {
    category: 'social',
    category_label: 'Social',
    icon: '💬',
    options: [
      "Text one person you've been avoiding.",
      'Call a friend or family member for 5 minutes.',
      "Send the message you've been putting off.",
      'Make one real plan with someone this week.',
    ],
  },
  {
    category: 'no_device',
    category_label: 'No device',
    icon: '📵',
    // Objects carry the boredom-timer duration; picking one opens the widget.
    options: [
      { label: 'Tank 5 minutes of boredom — no phone, no screens.', duration_minutes: 5 },
      { label: 'Tank 10 minutes of boredom — no phone, no screens.', duration_minutes: 10 },
      { label: 'Tank 15 minutes of boredom — no phone, no screens.', duration_minutes: 15 },
    ],
  },
  {
    category: 'money',
    category_label: 'Money',
    icon: '💸',
    options: [
      'Move $10 to savings right now.',
      'Donate $5 to charity.',
      'No spending for the rest of today.',
      'Put $5 in the penalty jar.',
    ],
  },
];

// The harsh, always-present final-straw option. Serving it arms the penalty
// focus lock (single-task mode until tomorrow, no exit).
export const LOCK_PUNISHMENT = {
  category: 'lock',
  category_label: 'Final straw',
  icon: '🔒',
  id: 'lock:until_tomorrow',
  label: 'Lock into single-task mode until tomorrow. No exit.',
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawOption(cat) {
  const idx = Math.floor(Math.random() * cat.options.length);
  const raw = cat.options[idx];
  const isObj = typeof raw === 'object';
  return {
    category: cat.category,
    category_label: cat.category_label,
    icon: cat.icon,
    id: `${cat.category}:${idx}`,
    label: isObj ? raw.label : raw,
    duration_minutes: isObj ? raw.duration_minutes : undefined,
  };
}

// Three random categories (one concrete punishment each) + the guaranteed lock.
export function rollPunishments() {
  const three = shuffle(CATEGORIES).slice(0, 3).map(drawOption);
  return [...three, { ...LOCK_PUNISHMENT }];
}
