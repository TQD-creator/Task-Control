// Same schema as ../../../db/schema.sql — mirrored here (rather than shared
// via a monorepo package) since the desktop app is a separate, independent
// port of the original React Native design. Keep both in sync if you touch
// the data model.

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS goals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT    NOT NULL,
    description     TEXT,
    action          TEXT,
    artifact        TEXT,
    category        TEXT,
    status          TEXT    NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'archived')),
    is_pinned       INTEGER NOT NULL DEFAULT 0,
    start_date      TEXT    NOT NULL DEFAULT (date('now')),
    target_date     TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS milestones (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id         INTEGER NOT NULL
                        REFERENCES goals (id) ON DELETE CASCADE,
    title           TEXT    NOT NULL,
    action          TEXT,
    artifact        TEXT,
    effort          TEXT    NOT NULL DEFAULT 'low'
                        CHECK (effort IN ('low', 'high')),
    impact          TEXT    NOT NULL DEFAULT 'low'
                        CHECK (impact IN ('low', 'high')),
    status          TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
    order_index     INTEGER NOT NULL DEFAULT 0,
    day_offset      INTEGER NOT NULL DEFAULT 0,
    start_date      TEXT,
    due_date        TEXT,
    completed_at    TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_milestones_goal_id ON milestones (goal_id);
CREATE INDEX IF NOT EXISTS idx_milestones_goal_order ON milestones (goal_id, order_index);

CREATE TABLE IF NOT EXISTS tasks (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    milestone_id        INTEGER NOT NULL
                            REFERENCES milestones (id) ON DELETE CASCADE,
    previous_task_id    INTEGER
                            REFERENCES tasks (id) ON DELETE SET NULL,
    title               TEXT    NOT NULL,
    action              TEXT,
    artifact            TEXT,
    effort              TEXT    NOT NULL DEFAULT 'low'
                            CHECK (effort IN ('low', 'high')),
    impact              TEXT    NOT NULL DEFAULT 'low'
                            CHECK (impact IN ('low', 'high')),
    status              TEXT    NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
    order_index         INTEGER NOT NULL DEFAULT 0,
    day_offset          INTEGER NOT NULL DEFAULT 0,
    scheduled_date      TEXT,
    estimated_minutes   INTEGER NOT NULL DEFAULT 0,
    actual_minutes      INTEGER,
    time_debt_delta     INTEGER,
    total_seconds       INTEGER NOT NULL DEFAULT 0,
    -- Serialized prep spec: { tools: [string], checklist: [{ text, done }], notes }.
    prep_json           TEXT,
    completed_at        TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_milestone_id ON tasks (milestone_id);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone_order ON tasks (milestone_id, order_index);
CREATE INDEX IF NOT EXISTS idx_tasks_previous_task_id ON tasks (previous_task_id);

-- Follow-ups: stateful loose ends a task leaves behind (submit it, email someone
-- and wait for a reply). A deterministic engine nudges on next_nudge_at and the
-- user resolves them in-app. See followUpEngine.js / reminderService.js.
CREATE TABLE IF NOT EXISTS follow_ups (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         INTEGER NOT NULL
                        REFERENCES tasks (id) ON DELETE CASCADE,
    kind            TEXT    NOT NULL DEFAULT 'custom'
                        CHECK (kind IN ('submit', 'notify_wait', 'custom')),
    label           TEXT    NOT NULL,
    question        TEXT,
    state           TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending', 'awaiting_reply', 'resolved')),
    due_date        TEXT,
    repeat_minutes  INTEGER NOT NULL DEFAULT 120,
    next_nudge_at   TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    resolved_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_task_id ON follow_ups (task_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_state ON follow_ups (state);

-- Quick Note pad: low-friction capture. A line can be classified via a "/"
-- slash-command (kind) and then routed on "process": plan -> Quick Capture,
-- chore/daily -> a chores row. Plain notes just stay.
CREATE TABLE IF NOT EXISTS notes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    text         TEXT    NOT NULL,
    kind         TEXT    NOT NULL DEFAULT 'note'
                     CHECK (kind IN ('note', 'plan', 'chore', 'daily')),
    status       TEXT    NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'processed', 'dismissed')),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notes_status ON notes (status);

-- Chores: one-off ('once') or repeating ('daily') reminders that live outside the
-- Goals tree. A daily chore is due each day until marked done (last_done_date <
-- today), then resets; an optional time_of_day gates when it starts nudging.
CREATE TABLE IF NOT EXISTS chores (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    recurrence     TEXT    NOT NULL DEFAULT 'daily'
                       CHECK (recurrence IN ('daily', 'once')),
    time_of_day    TEXT,
    due_date       TEXT,
    active         INTEGER NOT NULL DEFAULT 1,
    last_done_date TEXT,
    source_note_id INTEGER
                       REFERENCES notes (id) ON DELETE SET NULL,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chores_active ON chores (active);

CREATE TRIGGER IF NOT EXISTS trg_goals_updated_at
AFTER UPDATE ON goals
FOR EACH ROW
BEGIN
    UPDATE goals SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_milestones_updated_at
AFTER UPDATE ON milestones
FOR EACH ROW
BEGIN
    UPDATE milestones SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_tasks_updated_at
AFTER UPDATE ON tasks
FOR EACH ROW
BEGIN
    UPDATE tasks SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_follow_ups_updated_at
AFTER UPDATE ON follow_ups
FOR EACH ROW
BEGIN
    UPDATE follow_ups SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_notes_updated_at
AFTER UPDATE ON notes
FOR EACH ROW
BEGIN
    UPDATE notes SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_chores_updated_at
AFTER UPDATE ON chores
FOR EACH ROW
BEGIN
    UPDATE chores SET updated_at = datetime('now') WHERE id = OLD.id;
END;
`;

module.exports = { SCHEMA_SQL };
