// Executable copy of schema.sql as a JS string.
// Metro can't load raw .sql files without extra asset config, so the schema
// actually executed at runtime lives here; db/schema.sql is kept in sync as
// the human-readable/CLI-usable reference (e.g. `sqlite3 db < schema.sql`).

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS goals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT    NOT NULL,
    description     TEXT,
    action          TEXT,
    artifact        TEXT,
    status          TEXT    NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'archived')),
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
    completed_at        TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_milestone_id ON tasks (milestone_id);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone_order ON tasks (milestone_id, order_index);
CREATE INDEX IF NOT EXISTS idx_tasks_previous_task_id ON tasks (previous_task_id);

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
`;
