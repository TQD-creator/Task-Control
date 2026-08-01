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
  // Serialized prep spec (tools / checklist / notes) for the preparation phase.
  ensureColumn('tasks', 'prep_json', 'TEXT');
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

// Effort/Impact quadrant label (matches EffortImpactMatrix in the renderer).
function quadrantLabel(effort, impact) {
  if (impact === 'high' && effort === 'low') return 'Quick Win';
  if (impact === 'high' && effort === 'high') return 'Big Bet';
  if (impact === 'low' && effort === 'low') return 'Filler';
  return 'Trap'; // low impact / high effort
}

// Priority score for the smart queue. Higher = do sooner. Impact dominates
// (weight ×2), effort is a mild penalty (cheap wins float up), and due-date
// urgency stacks on top so an overdue task always outranks a not-yet-due one
// of the same quadrant. The raw scheduled_date/order_index remain the stable
// tiebreaker back in getActiveTaskQueue's sort.
//
// `slipMap` (optional) is the adaptive layer: a per-quadrant historical
// slip-rate (from getReliabilityStats). A task whose quadrant is chronically
// slipped (>50%) gets a +1 nudge so the work-type the user reliably lets rot
// surfaces earlier — the learned reliability feeds ordering, not just charts.
function computePriority(task, todayStr, slipMap = null) {
  const impactWeight = task.impact === 'high' ? 2 : 1;
  const effortWeight = task.effort === 'high' ? 2 : 1;
  let urgency = 0;
  const date = task.scheduled_date || task.due_date || null;
  if (date) {
    if (date < todayStr) urgency = 3; // overdue
    else {
      const days = Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${todayStr}T00:00:00Z`)) / 86400000);
      if (days <= 2) urgency = 2;
      else if (days <= 7) urgency = 1;
    }
  }
  const slipBonus = slipMap && slipMap[quadrantLabel(task.effort, task.impact)] > 0.5 ? 1 : 0;
  return impactWeight * 2 - effortWeight + urgency + slipBonus;
}

// Active queue for the Dashboard: pending/in_progress tasks across all goals.
// Each row is decorated with a priority score, an `overdue` flag, and a
// quadrant label; sorted by priority (desc) with the original chronological
// order as the stable tiebreaker. The renderer can re-sort by date if it wants.
function getActiveTaskQueue() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const rows = all(
    `SELECT tasks.*, milestones.title AS milestone_title, goals.title AS goal_title
     FROM tasks
     JOIN milestones ON milestones.id = tasks.milestone_id
     JOIN goals ON goals.id = milestones.goal_id
     WHERE tasks.status IN ('pending', 'in_progress')
     ORDER BY tasks.scheduled_date ASC, tasks.order_index ASC`
  );
  const slipMap = getQuadrantSlipMap();
  return rows
    .map((t) => {
      const date = t.scheduled_date || t.due_date || null;
      const quadrant = quadrantLabel(t.effort, t.impact);
      return {
        ...t,
        priority: computePriority(t, todayStr, slipMap),
        overdue: !!date && date < todayStr,
        quadrant,
        slip_risk: slipMap[quadrant] > 0.5,
      };
    })
    .sort((a, b) => b.priority - a.priority); // Array.sort is stable → keeps date order within a tier
}

// Per-quadrant slip rate = (late completions + still-open overdue) / all tasks
// seen in that quadrant. Only quadrants with a minimum sample count report a
// rate, so a single fluke never re-orders the queue. Feeds computePriority and
// the dashboard slip-risk chip.
function getQuadrantSlipMap(weeks = 8, minSamples = 3) {
  const rel = getReliabilityStats(weeks);
  const map = {};
  for (const [quadrant, c] of Object.entries(rel.by_quadrant)) {
    const total = (c.on_time || 0) + (c.late || 0) + (c.slipped || 0);
    if (total >= minSamples) map[quadrant] = ((c.late || 0) + (c.slipped || 0)) / total;
  }
  return map;
}

// Aggregate completion stats for the Insights screen. Reads back what the app
// has been silently recording: how many tasks are done vs. still open, total
// tracked/estimated time, and a per-day completion count for the last ~8 weeks
// (feeds the streak heatmap). Dates are grouped on completed_at's local date.
function getCompletionStats(weeks = 8) {
  const totals = get(
    `SELECT
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status IN ('pending', 'in_progress') THEN 1 ELSE 0 END) AS open,
       COALESCE(SUM(total_seconds), 0) AS total_seconds,
       COALESCE(SUM(CASE WHEN status = 'completed' THEN actual_minutes ELSE 0 END), 0) AS actual_minutes
     FROM tasks`
  ) || {};
  const sinceDays = weeks * 7;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - sinceDays);
  const sinceStr = since.toISOString().slice(0, 10);
  const byDay = all(
    `SELECT date(completed_at) AS day, COUNT(*) AS count,
            COALESCE(SUM(actual_minutes), 0) AS minutes
     FROM tasks
     WHERE status = 'completed' AND completed_at IS NOT NULL AND date(completed_at) >= ?
     GROUP BY date(completed_at)
     ORDER BY day ASC`,
    [sinceStr]
  );
  return {
    completed: totals.completed || 0,
    open: totals.open || 0,
    total_seconds: totals.total_seconds || 0,
    actual_minutes: totals.actual_minutes || 0,
    by_day: byDay,
    weeks,
  };
}

// Tasks the reminder service should nudge about: still open and scheduled for
// today or earlier. Tasks carry scheduled_date only (due_date lives on
// milestones), so the reminder keys off that. Cheapest possible shape — just
// what a notification needs.
function getDueTasks(todayStr) {
  return all(
    `SELECT id, title, scheduled_date
     FROM tasks
     WHERE status IN ('pending', 'in_progress')
       AND scheduled_date IS NOT NULL
       AND scheduled_date <= ?`,
    [todayStr]
  );
}

// Reliability = how the user's finished (and unfinished) work lands against its
// own scheduled/due date — the adaptive signal the app records but never reads
// back. Of tasks completed in the window: on_time (done on/before its date, or
// dateless) vs. late (done after). Plus a snapshot of currently-open tasks whose
// date has already passed (slipped). Broken out overall and per Effort/Impact
// quadrant so a work-type the user chronically lets rot is visible.
function getReliabilityStats(weeks = 8) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - weeks * 7);
  const sinceStr = since.toISOString().slice(0, 10);

  // Tasks carry scheduled_date only (due_date lives on milestones), so that's
  // the deadline every classification here compares against.
  const completed = all(
    `SELECT effort, impact, scheduled_date, date(completed_at) AS done
     FROM tasks
     WHERE status = 'completed' AND completed_at IS NOT NULL AND date(completed_at) >= ?`,
    [sinceStr]
  );
  const open = all(
    `SELECT effort, impact, scheduled_date
     FROM tasks
     WHERE status IN ('pending', 'in_progress')`
  );

  const byQuadrant = {};
  const bump = (effort, impact, field) => {
    const q = quadrantLabel(effort, impact);
    const cell = (byQuadrant[q] = byQuadrant[q] || { on_time: 0, late: 0, slipped: 0 });
    cell[field] += 1;
  };

  let on_time = 0;
  let late = 0;
  let slipped_open = 0;
  for (const t of completed) {
    const due = t.scheduled_date || null;
    if (!due || t.done <= due) { on_time += 1; bump(t.effort, t.impact, 'on_time'); }
    else { late += 1; bump(t.effort, t.impact, 'late'); }
  }
  for (const t of open) {
    const due = t.scheduled_date || null;
    if (due && due < todayStr) { slipped_open += 1; bump(t.effort, t.impact, 'slipped'); }
  }
  return { on_time, late, slipped_open, by_quadrant: byQuadrant, weeks };
}

// Planned load per upcoming day: for open tasks scheduled in [fromDate, +days),
// the task count and summed estimated_minutes per day. Feeds the New-Task
// overload warning and the Insights load strip (compared against learned
// capacity in the renderer). Only days that actually carry work are returned.
function getScheduleLoad(fromDate, days = 14) {
  const from = fromDate || new Date().toISOString().slice(0, 10);
  const to = addDays(from, days);
  const byDay = all(
    `SELECT scheduled_date AS day, COUNT(*) AS count,
            COALESCE(SUM(estimated_minutes), 0) AS est_minutes
     FROM tasks
     WHERE status IN ('pending', 'in_progress')
       AND scheduled_date IS NOT NULL
       AND scheduled_date >= ? AND scheduled_date < ?
     GROUP BY scheduled_date
     ORDER BY scheduled_date ASC`,
    [from, to]
  );
  return { from, days, by_day: byDay };
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

// ---------------------------------------------------------------------------
// FOLLOW-UPS (loose ends a task leaves behind: submit it, email + await reply)
// ---------------------------------------------------------------------------

function createFollowUp({
  taskId,
  kind = 'custom',
  label,
  question = null,
  dueDate = null,
  repeatMinutes = 120,
  nextNudgeAt = null,
  state = 'pending',
}) {
  run(
    `INSERT INTO follow_ups (task_id, kind, label, question, state, due_date, repeat_minutes, next_nudge_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [taskId, kind, label, question, state, dueDate, repeatMinutes, nextNudgeAt]
  );
  const id = lastInsertRowId();
  persist();
  return getFollowUpById(id);
}

function getFollowUpById(id) {
  return get(`SELECT * FROM follow_ups WHERE id = ?`, [id]);
}

function getFollowUpsByTask(taskId) {
  return all(`SELECT * FROM follow_ups WHERE task_id = ? ORDER BY created_at ASC`, [taskId]);
}

// All unresolved follow-ups, decorated with their task/goal titles, for the
// in-app inbox. NULL next_nudge_at (not yet scheduled) sorts last.
function getPendingFollowUps() {
  return all(
    `SELECT f.*, t.title AS task_title, g.title AS goal_title
     FROM follow_ups f
     JOIN tasks t ON t.id = f.task_id
     JOIN milestones m ON m.id = t.milestone_id
     JOIN goals g ON g.id = m.goal_id
     WHERE f.state != 'resolved'
     ORDER BY (f.next_nudge_at IS NULL), f.next_nudge_at ASC`
  );
}

// Unresolved follow-ups whose nudge time has arrived — the reminder loop fires
// these (unless a focus lock is active; see reminderService).
function getDueFollowUps(nowIso) {
  return all(
    `SELECT f.*, t.title AS task_title
     FROM follow_ups f
     JOIN tasks t ON t.id = f.task_id
     WHERE f.state != 'resolved'
       AND f.next_nudge_at IS NOT NULL
       AND f.next_nudge_at <= ?
     ORDER BY f.next_nudge_at ASC`,
    [nowIso]
  );
}

function updateFollowUp(id, fields) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return getFollowUpById(id);
  const setClause = columns.map((c) => `${c} = ?`).join(', ');
  run(`UPDATE follow_ups SET ${setClause} WHERE id = ?`, [...columns.map((c) => fields[c]), id]);
  persist();
  return getFollowUpById(id);
}

function deleteFollowUp(id) {
  run(`DELETE FROM follow_ups WHERE id = ?`, [id]);
  persist();
}

// ---------------------------------------------------------------------------
// NOTES (Quick Note pad) + CHORES (one-off / daily reminders)
// ---------------------------------------------------------------------------

function createNote({ text, kind = 'note' }) {
  run(`INSERT INTO notes (text, kind) VALUES (?, ?)`, [text, kind]);
  const id = lastInsertRowId();
  persist();
  return getNoteById(id);
}

function getNoteById(id) {
  return get(`SELECT * FROM notes WHERE id = ?`, [id]);
}

// All non-dismissed notes, newest first (the pad).
function getNotes() {
  return all(`SELECT * FROM notes WHERE status != 'dismissed' ORDER BY created_at DESC`);
}

// The process queue: still-open notes that were classified into an actionable kind.
function getOpenClassifiedNotes() {
  return all(
    `SELECT * FROM notes
     WHERE status = 'open' AND kind IN ('plan', 'chore', 'daily')
     ORDER BY created_at ASC`
  );
}

function updateNote(id, fields) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return getNoteById(id);
  const setClause = columns.map((c) => `${c} = ?`).join(', ');
  run(`UPDATE notes SET ${setClause} WHERE id = ?`, [...columns.map((c) => fields[c]), id]);
  persist();
  return getNoteById(id);
}

function deleteNote(id) {
  run(`DELETE FROM notes WHERE id = ?`, [id]);
  persist();
}

function createChore({ title, recurrence = 'daily', timeOfDay = null, dueDate = null, sourceNoteId = null }) {
  run(
    `INSERT INTO chores (title, recurrence, time_of_day, due_date, source_note_id)
     VALUES (?, ?, ?, ?, ?)`,
    [title, recurrence, timeOfDay, dueDate, sourceNoteId]
  );
  const id = lastInsertRowId();
  persist();
  return getChoreById(id);
}

function getChoreById(id) {
  return get(`SELECT * FROM chores WHERE id = ?`, [id]);
}

function getChores() {
  return all(`SELECT * FROM chores ORDER BY active DESC, recurrence ASC, title ASC`);
}

function updateChore(id, fields) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return getChoreById(id);
  const setClause = columns.map((c) => `${c} = ?`).join(', ');
  run(`UPDATE chores SET ${setClause} WHERE id = ?`, [...columns.map((c) => fields[c]), id]);
  persist();
  return getChoreById(id);
}

// Mark a chore done for today. A daily chore just records the date (it resets
// tomorrow); a one-off chore is finished, so it's deactivated.
function markChoreDone(id) {
  const chore = getChoreById(id);
  if (!chore) return null;
  const todayStr = new Date().toISOString().slice(0, 10);
  if (chore.recurrence === 'once') {
    run(`UPDATE chores SET last_done_date = ?, active = 0 WHERE id = ?`, [todayStr, id]);
  } else {
    run(`UPDATE chores SET last_done_date = ? WHERE id = ?`, [todayStr, id]);
  }
  persist();
  return getChoreById(id);
}

function deleteChore(id) {
  run(`DELETE FROM chores WHERE id = ?`, [id]);
  persist();
}

// Chores that should nudge now: active, past any time-of-day gate, and not yet
// satisfied — a daily chore not done today, or a one-off not done whose date has
// arrived (a one-off with no date is due immediately). nowHHMM is local 'HH:MM'.
function getDueChores(todayStr, nowHHMM) {
  return all(
    `SELECT id, title, recurrence, time_of_day, due_date, last_done_date
     FROM chores
     WHERE active = 1
       AND (time_of_day IS NULL OR time_of_day <= ?)
       AND (
         (recurrence = 'daily' AND (last_done_date IS NULL OR last_done_date < ?))
         OR
         (recurrence = 'once' AND last_done_date IS NULL AND (due_date IS NULL OR due_date <= ?))
       )`,
    [nowHHMM, todayStr, todayStr]
  );
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
  getCompletionStats,
  getReliabilityStats,
  getScheduleLoad,
  getDueTasks,
  updateTask,
  deleteTask,
  completeTask,
  addTaskTime,
  shiftTaskTimeline,
  shiftMilestoneTimeline,
  createFollowUp,
  getFollowUpById,
  getFollowUpsByTask,
  getPendingFollowUps,
  getDueFollowUps,
  updateFollowUp,
  deleteFollowUp,
  createNote,
  getNoteById,
  getNotes,
  getOpenClassifiedNotes,
  updateNote,
  deleteNote,
  createChore,
  getChoreById,
  getChores,
  updateChore,
  markChoreDone,
  deleteChore,
  getDueChores,
};
