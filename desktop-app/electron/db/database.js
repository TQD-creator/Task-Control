// Electron main-process DB access layer — sql.js (WASM SQLite) port of the
// original React Native db/database.js. sql.js needs no native compilation
// (unlike better-sqlite3, which requires a full VS C++ toolchain to build),
// at the cost of manually exporting the in-memory DB to disk after writes.
// Same CRUD + Shift Timeline cascade design (day_offset relative to the
// parent's start_date so a shift is one arithmetic delta applied down the
// chain, not N absolute rewrites).

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { SCHEMA_SQL } = require('./schemaSql');

let db = null;
let filePath = null;

async function initDatabase(dbFilePath) {
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  filePath = dbFilePath;
  if (fs.existsSync(filePath)) {
    db = new SQL.Database(fs.readFileSync(filePath));
  } else {
    db = new SQL.Database();
  }

  // exec() (not run()) is what supports a script of multiple ;-separated
  // statements in one call, which the schema is.
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);
  runMigrations();
  persist({ immediate: true }); // ensure the file exists before first write

  return db;
}

// CREATE TABLE IF NOT EXISTS is a no-op on a table that already exists on
// disk, so a new column added to schemaSql.js never reaches a database that
// was created before that change. This adds any columns still missing from
// an existing on-disk db, in place of a full migration framework.
function runMigrations() {
  ensureColumn('goals', 'is_pinned', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('goals', 'category', 'TEXT');
  // Accumulated tracked time for the floating timer widget. Lives on the task
  // so "Total Overall Time" survives restarts; the in-progress session lives
  // only in the main-process timerService until it's flushed here.
  ensureColumn('tasks', 'total_seconds', 'INTEGER NOT NULL DEFAULT 0');
}

function ensureColumn(table, column, definition) {
  const columns = all(`PRAGMA table_info(${table})`);
  const exists = columns.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

let persistTimer = null;
let persistPending = false;

// ATOMIC write: serialize to a temp file, then rename over the real one. A
// plain in-place writeFileSync that's interrupted mid-write (and the timer
// widget is explicitly designed around abrupt close) leaves a truncated,
// unopenable db. rename() is atomic on the same filesystem, so a crash leaves
// either the old or the new file intact — never a half-written one.
function writeNow() {
  const data = db.export();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(data));
  fs.renameSync(tmp, filePath);
}

// DEBOUNCED persistence. db.export() is O(entire database) and blocks the main
// thread, yet the timer flushes every 5s and every CRUD call persists. sql.js
// keeps the source of truth in memory, so reads after a mutation are already
// correct before the file is rewritten — we can safely coalesce disk writes
// behind a trailing 1.5s timer. Pass { immediate: true } to force a synchronous
// flush at durability points (app quit, timer pause/close).
function persist({ immediate = false } = {}) {
  if (immediate) {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    persistPending = false;
    writeNow();
    return;
  }
  persistPending = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistPending) { persistPending = false; writeNow(); }
  }, 1500);
  // Don't let a pending debounce keep the process alive at shutdown; before-quit
  // does an immediate flush anyway.
  if (persistTimer.unref) persistTimer.unref();
}

// ---------------------------------------------------------------------------
// Thin query helpers — sql.js only gives you a step/getAsObject cursor API,
// so wrap it into the get/all/run shape the rest of this file (and the
// original React Native version) is written against.
// ---------------------------------------------------------------------------

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] ?? null;
}

function run(sql, params = []) {
  db.run(sql, params);
}

function lastInsertRowId() {
  return get('SELECT last_insert_rowid() AS id').id;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// GOALS
// ---------------------------------------------------------------------------

function createGoal({ title, description = null, action = null, artifact = null, category = null, startDate = null, targetDate = null }) {
  run(
    `INSERT INTO goals (title, description, action, artifact, category, start_date, target_date)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, date('now')), ?)`,
    [title, description, action, artifact, category, startDate, targetDate]
  );
  const goal = getGoalById(lastInsertRowId());
  persist();
  return goal;
}

function getGoals() {
  return all(`SELECT * FROM goals ORDER BY is_pinned DESC, created_at DESC`);
}

function getGoalById(id) {
  return get(`SELECT * FROM goals WHERE id = ?`, [id]);
}

function updateGoal(id, fields) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return getGoalById(id);
  const setClause = columns.map((col) => `${col} = ?`).join(', ');
  run(`UPDATE goals SET ${setClause} WHERE id = ?`, [...columns.map((c) => fields[c]), id]);
  persist();
  return getGoalById(id);
}

function deleteGoal(id) {
  run(`DELETE FROM goals WHERE id = ?`, [id]);
  persist();
}

// ---------------------------------------------------------------------------
// MILESTONES
// ---------------------------------------------------------------------------

function createMilestone({ goalId, title, action = null, artifact = null, effort = 'low', impact = 'low', dayOffset = 0 }) {
  const { maxOrder } = get(`SELECT COALESCE(MAX(order_index), -1) AS maxOrder FROM milestones WHERE goal_id = ?`, [goalId]);
  const goal = getGoalById(goalId);
  const startDate = addDays(goal.start_date, dayOffset);

  run(
    `INSERT INTO milestones (goal_id, title, action, artifact, effort, impact, order_index, day_offset, start_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [goalId, title, action, artifact, effort, impact, maxOrder + 1, dayOffset, startDate]
  );
  const milestone = getMilestoneById(lastInsertRowId());
  persist();
  return milestone;
}

function getMilestonesByGoal(goalId) {
  return all(`SELECT * FROM milestones WHERE goal_id = ? ORDER BY order_index`, [goalId]);
}

function getMilestoneById(id) {
  return get(`SELECT * FROM milestones WHERE id = ?`, [id]);
}

function updateMilestone(id, fields) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return getMilestoneById(id);
  const setClause = columns.map((col) => `${col} = ?`).join(', ');
  run(`UPDATE milestones SET ${setClause} WHERE id = ?`, [...columns.map((c) => fields[c]), id]);
  persist();
  return getMilestoneById(id);
}

function deleteMilestone(id) {
  run(`DELETE FROM milestones WHERE id = ?`, [id]);
  persist();
}

// ---------------------------------------------------------------------------
// TASKS
// ---------------------------------------------------------------------------

function createTask({
  milestoneId,
  title,
  action = null,
  artifact = null,
  effort = 'low',
  impact = 'low',
  estimatedMinutes = 0,
  dayOffset = 0,
  previousTaskId = null,
}) {
  const { maxOrder } = get(`SELECT COALESCE(MAX(order_index), -1) AS maxOrder FROM tasks WHERE milestone_id = ?`, [milestoneId]);
  const milestone = getMilestoneById(milestoneId);
  const scheduledDate = addDays(milestone.start_date, dayOffset);

  run(
    `INSERT INTO tasks (milestone_id, previous_task_id, title, action, artifact, effort, impact, order_index, day_offset, scheduled_date, estimated_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [milestoneId, previousTaskId, title, action, artifact, effort, impact, maxOrder + 1, dayOffset, scheduledDate, estimatedMinutes]
  );
  const task = getTaskById(lastInsertRowId());
  persist();
  return task;
}

function getTasksByMilestone(milestoneId) {
  return all(`SELECT * FROM tasks WHERE milestone_id = ? ORDER BY order_index`, [milestoneId]);
}

function getTaskById(id) {
  return get(`SELECT * FROM tasks WHERE id = ?`, [id]);
}

// Active queue for the Dashboard: pending/in_progress tasks across all goals,
// soonest scheduled_date first.
function getActiveTaskQueue() {
  return all(
    `SELECT tasks.*, milestones.title AS milestone_title, goals.title AS goal_title
     FROM tasks
     JOIN milestones ON milestones.id = tasks.milestone_id
     JOIN goals ON goals.id = milestones.goal_id
     WHERE tasks.status IN ('pending', 'in_progress')
     ORDER BY tasks.scheduled_date ASC, tasks.order_index ASC`
  );
}

function updateTask(id, fields) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return getTaskById(id);
  const setClause = columns.map((col) => `${col} = ?`).join(', ');
  run(`UPDATE tasks SET ${setClause} WHERE id = ?`, [...columns.map((c) => fields[c]), id]);
  persist();
  return getTaskById(id);
}

function deleteTask(id) {
  run(`DELETE FROM tasks WHERE id = ?`, [id]);
  persist();
}

// Marks a task complete and records the estimate-vs-actual delta consumed by
// the Personalization Engine to update Time Debt / Guilt-Free Bank.
function completeTask(id, actualMinutes) {
  const task = getTaskById(id);
  const delta = actualMinutes - task.estimated_minutes;
  run(
    `UPDATE tasks
     SET status = 'completed', actual_minutes = ?, time_debt_delta = ?, completed_at = datetime('now')
     WHERE id = ?`,
    [actualMinutes, delta, id]
  );
  persist();
  return getTaskById(id);
}

// Folds a chunk of tracked seconds into a task's running total. Called by the
// timerService's 5-second flush (and its final pause flush) so accumulated
// time is crash-safe rather than only being written on unmount. Returns the
// fresh row so the widget can show the updated total.
function addTaskTime(id, seconds) {
  if (!seconds) return getTaskById(id);
  run(`UPDATE tasks SET total_seconds = total_seconds + ? WHERE id = ?`, [seconds, id]);
  persist();
  return getTaskById(id);
}

// ---------------------------------------------------------------------------
// SHIFT TIMELINE
// ---------------------------------------------------------------------------

function shiftTaskTimeline(taskId, deltaDays) {
  if (deltaDays === 0) return [];

  const task = getTaskById(taskId);
  const milestone = getMilestoneById(task.milestone_id);

  const dependents = all(
    `SELECT id, day_offset FROM tasks WHERE milestone_id = ? AND order_index >= ? ORDER BY order_index`,
    [task.milestone_id, task.order_index]
  );

  for (const dep of dependents) {
    const newOffset = dep.day_offset + deltaDays;
    const newScheduledDate = addDays(milestone.start_date, newOffset);
    run(`UPDATE tasks SET day_offset = ?, scheduled_date = ? WHERE id = ?`, [newOffset, newScheduledDate, dep.id]);
  }
  persist();

  return getTasksByMilestone(task.milestone_id);
}

function shiftMilestoneTimeline(milestoneId, deltaDays) {
  if (deltaDays === 0) return [];

  const milestone = getMilestoneById(milestoneId);
  const goal = getGoalById(milestone.goal_id);

  const dependents = all(
    `SELECT id, day_offset FROM milestones WHERE goal_id = ? AND order_index >= ? ORDER BY order_index`,
    [milestone.goal_id, milestone.order_index]
  );

  for (const dep of dependents) {
    const newOffset = dep.day_offset + deltaDays;
    const newStartDate = addDays(goal.start_date, newOffset);
    run(`UPDATE milestones SET day_offset = ?, start_date = ? WHERE id = ?`, [newOffset, newStartDate, dep.id]);

    const tasks = all(`SELECT id, day_offset FROM tasks WHERE milestone_id = ?`, [dep.id]);
    for (const t of tasks) {
      const newScheduledDate = addDays(newStartDate, t.day_offset);
      run(`UPDATE tasks SET scheduled_date = ? WHERE id = ?`, [newScheduledDate, t.id]);
    }
  }
  persist();

  return getMilestonesByGoal(milestone.goal_id);
}

module.exports = {
  initDatabase,
  persist,
  createGoal,
  getGoals,
  getGoalById,
  updateGoal,
  deleteGoal,
  createMilestone,
  getMilestonesByGoal,
  getMilestoneById,
  updateMilestone,
  deleteMilestone,
  createTask,
  getTasksByMilestone,
  getTaskById,
  getActiveTaskQueue,
  updateTask,
  deleteTask,
  completeTask,
  addTaskTime,
  shiftTaskTimeline,
  shiftMilestoneTimeline,
};
