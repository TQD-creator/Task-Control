// Quick Note pad helpers. Pure + dependency-free so the parser is unit-testable.
//
// A note line can be classified by a leading "/" slash-command; anything else is
// a plain kept note. The classification (kind) decides how the note routes when
// you "process" it: plan -> Quick Capture, chore -> one-off reminder, daily ->
// repeating daily chore.

export const SLASH_COMMANDS = [
  { cmd: '/plan', kind: 'plan', label: 'Plan', hint: '→ Quick Capture (AI breakdown)' },
  { cmd: '/chore', kind: 'chore', label: 'Chore', hint: '→ one-off reminder' },
  { cmd: '/daily', kind: 'daily', label: 'Daily chore', hint: '→ repeats every day' },
];

const KIND_BY_CMD = { plan: 'plan', chore: 'chore', daily: 'daily' };

// "/daily Stretch 10 min" -> { kind: 'daily', text: 'Stretch 10 min' }.
// A leading command with no text after it (e.g. just "/plan") is treated as
// plain text so a half-typed command isn't silently swallowed.
export function parseNoteInput(raw) {
  const text = (raw || '').trim();
  const m = text.match(/^\/(plan|chore|daily)\s+(.+)$/i);
  if (m) {
    const kind = KIND_BY_CMD[m[1].toLowerCase()];
    return { kind, text: m[2].trim() };
  }
  return { kind: 'note', text };
}

export const KIND_META = {
  note: { label: 'Note', chip: 'note' },
  plan: { label: 'Plan', chip: 'plan' },
  chore: { label: 'Chore', chip: 'chore' },
  daily: { label: 'Daily', chip: 'daily' },
};
