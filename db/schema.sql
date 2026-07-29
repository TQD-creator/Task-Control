-- Task Control App — SQLite schema
-- Core hierarchy: Goal -> Milestone -> Task
-- Tasks are scheduled *relatively* (day_offset from their milestone's start_date,
-- plus a previous_task_id chain) so the "Shift Timeline" feature can cascade a
-- date change through dependent tasks without rewriting every absolute date.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- GOALS
-- The "Big Vague Goal" the user actually typed, plus the structured artifact
-- it gets decomposed into. This is the root of the tree.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT    NOT NULL,
    description     TEXT,
    action          TEXT,                       -- e.g. "Launch"
    artifact        TEXT,                       -- e.g. "a personal portfolio site"
    category        TEXT,                                     -- e.g. "self-improvement", "creative", "project idea"
    status          TEXT    NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'archived')),
    is_pinned       INTEGER NOT NULL DEFAULT 0,                -- pinned goals sort first in the goal tag row
    start_date      TEXT    NOT NULL DEFAULT (date('now')),   -- ISO-8601 date
    target_date     TEXT,                                     -- ISO-8601 date, optional
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- MILESTONES
-- Belongs to a Goal. Carries the Effort/Impact matrix classification used by
-- the planning UI (Step 5) and the day_offset/order_index pair used for
-- relative scheduling within the Goal's timeline.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS milestones (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id         INTEGER NOT NULL
                        REFERENCES goals (id) ON DELETE CASCADE,
    title           TEXT    NOT NULL,
    action          TEXT,                       -- split input: verb
    artifact        TEXT,                       -- split input: concrete deliverable
    effort          TEXT    NOT NULL DEFAULT 'low'
                        CHECK (effort IN ('low', 'high')),
    impact          TEXT    NOT NULL DEFAULT 'low'
                        CHECK (impact IN ('low', 'high')),
    status          TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
    order_index     INTEGER NOT NULL DEFAULT 0,  -- sequence among siblings under the same goal
    day_offset      INTEGER NOT NULL DEFAULT 0,  -- days from goal.start_date
    start_date      TEXT,                        -- cached/computed ISO-8601 date
    due_date        TEXT,                        -- cached/computed ISO-8601 date
    completed_at    TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_milestones_goal_id ON milestones (goal_id);
CREATE INDEX IF NOT EXISTS idx_milestones_goal_order ON milestones (goal_id, order_index);

-- ---------------------------------------------------------------------------
-- TASKS
-- Belongs to a Milestone. previous_task_id forms an ordered chain within the
-- milestone so "Shift Timeline" can walk forward from any task and cascade
-- day_offset changes to everything after it. day_offset is relative to the
-- parent milestone's start_date, not an absolute date, so a shift is a single
-- arithmetic delta applied down the chain rather than N individual edits.
-- estimated_minutes / actual_minutes feed the Time Debt calculation in Step 3.
-- ---------------------------------------------------------------------------
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
    order_index         INTEGER NOT NULL DEFAULT 0,   -- sequence among siblings under the same milestone
    day_offset          INTEGER NOT NULL DEFAULT 0,   -- days from milestone.start_date
    scheduled_date       TEXT,                         -- cached/computed ISO-8601 date
    estimated_minutes    INTEGER NOT NULL DEFAULT 0,
    actual_minutes       INTEGER,                       -- filled in on completion
    time_debt_delta      INTEGER,                       -- actual_minutes - estimated_minutes, snapshot at completion
    completed_at         TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_milestone_id ON tasks (milestone_id);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone_order ON tasks (milestone_id, order_index);
CREATE INDEX IF NOT EXISTS idx_tasks_previous_task_id ON tasks (previous_task_id);

-- ---------------------------------------------------------------------------
-- Keep updated_at fresh on every mutation (SQLite has no ON UPDATE clause).
-- ---------------------------------------------------------------------------
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
