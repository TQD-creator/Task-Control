// React Native SQLite access layer (expo-sqlite async API).
// Loads db/schema.sql on first open, then exposes CRUD for Goals/Milestones/Tasks
// plus the cascading "Shift Timeline" update.

import * as SQLite from 'expo-sqlite';
import { SCHEMA_SQL } from './schemaSql';

const DB_NAME = 'task_control.db';
let dbInstance = null;

export async function getDatabase() {
  if (dbInstance) return dbInstance;

  dbInstance = await SQLite.openDatabaseAsync(DB_NAME);
  await dbInstance.execAsync(SCHEMA_SQL);

  return dbInstance;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// GOALS
// ---------------------------------------------------------------------------

export async function createGoal({ title, description = null, action = null, artifact = null, startDate = null, targetDate = null }) {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO goals (title, description, action, artifact, start_date, target_date)
     VALUES (?, ?, ?, ?, COALESCE(?, date('now')), ?)`,
    [title, description, action, artifact, startDate, targetDate]
  );
  return getGoalById(result.lastInsertRowId);
}

export async function getGoals() {
  const db = await getDatabase();
  return db.getAllAsync(`SELECT * FROM goals ORDER BY created_at DESC`);
}

export async function getGoalById(id) {
  const db = await getDatabase();
  return db.getFirstAsync(`SELECT * FROM goals WHERE id = ?`, [id]);
}

export async function updateGoal(id, fields) {
  const db = await getDatabase();
  const columns = Object.keys(fields);
  if (columns.length === 0) return getGoalById(id);
  const setClause = columns.map((col) => `${col} = ?`).join(', ');
  await db.runAsync(`UPDATE goals SET ${setClause} WHERE id = ?`, [...columns.map((c) => fields[c]), id]);
  return getGoalById(id);
}

export async function deleteGoal(id) {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM goals WHERE id = ?`, [id]);
}

// ---------------------------------------------------------------------------
// MILESTONES
// ---------------------------------------------------------------------------

export async function createMilestone({ goalId, title, action = null, artifact = null, effort = 'low', impact = 'low', dayOffset = 0 }) {
  const db = await getDatabase();
  const { maxOrder } = await db.getFirstAsync(
    `SELECT COALESCE(MAX(order_index), -1) AS maxOrder FROM milestones WHERE goal_id = ?`,
    [goalId]
  );
  const goal = await getGoalById(goalId);
  const startDate = addDays(goal.start_date, dayOffset);

  const result = await db.runAsync(
    `INSERT INTO milestones (goal_id, title, action, artifact, effort, impact, order_index, day_offset, start_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [goalId, title, action, artifact, effort, impact, maxOrder + 1, dayOffset, startDate]
  );
  return getMilestoneById(result.lastInsertRowId);
}

export async function getMilestonesByGoal(goalId) {
  const db = await getDatabase();
  return db.getAllAsync(`SELECT * FROM milestones WHERE goal_id = ? ORDER BY order_index`, [goalId]);
}

export async function getMilestoneById(id) {
  const db = await getDatabase();
  return db.getFirstAsync(`SELECT * FROM milestones WHERE id = ?`, [id]);
}

export async function updateMilestone(id, fields) {
  const db = await getDatabase();
  const columns = Object.keys(fields);
  if (columns.length === 0) return getMilestoneById(id);
  const setClause = columns.map((col) => `${col} = ?`).join(', ');
  await db.runAsync(`UPDATE milestones SET ${setClause} WHERE id = ?`, [...columns.map((c) => fields[c]), id]);
  return getMilestoneById(id);
}

export async function deleteMilestone(id) {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM milestones WHERE id = ?`, [id]);
}

// ---------------------------------------------------------------------------
// TASKS
// ---------------------------------------------------------------------------

export async function createTask({
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
  const db = await getDatabase();
  const { maxOrder } = await db.getFirstAsync(
    `SELECT COALESCE(MAX(order_index), -1) AS maxOrder FROM tasks WHERE milestone_id = ?`,
    [milestoneId]
  );
  const milestone = await getMilestoneById(milestoneId);
  const scheduledDate = addDays(milestone.start_date, dayOffset);

  const result = await db.runAsync(
    `INSERT INTO tasks (milestone_id, previous_task_id, title, action, artifact, effort, impact, order_index, day_offset, scheduled_date, estimated_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [milestoneId, previousTaskId, title, action, artifact, effort, impact, maxOrder + 1, dayOffset, scheduledDate, estimatedMinutes]
  );
  return getTaskById(result.lastInsertRowId);
}

export async function getTasksByMilestone(milestoneId) {
  const db = await getDatabase();
  return db.getAllAsync(`SELECT * FROM tasks WHERE milestone_id = ? ORDER BY order_index`, [milestoneId]);
}

export async function getTaskById(id) {
  const db = await getDatabase();
  return db.getFirstAsync(`SELECT * FROM tasks WHERE id = ?`, [id]);
}

// Active queue for the Dashboard: pending/in_progress tasks across all goals,
// soonest scheduled_date first.
export async function getActiveTaskQueue() {
  const db = await getDatabase();
  return db.getAllAsync(
    `SELECT tasks.*, milestones.title AS milestone_title, goals.title AS goal_title
     FROM tasks
     JOIN milestones ON milestones.id = tasks.milestone_id
     JOIN goals ON goals.id = milestones.goal_id
     WHERE tasks.status IN ('pending', 'in_progress')
     ORDER BY tasks.scheduled_date ASC, tasks.order_index ASC`
  );
}

export async function updateTask(id, fields) {
  const db = await getDatabase();
  const columns = Object.keys(fields);
  if (columns.length === 0) return getTaskById(id);
  const setClause = columns.map((col) => `${col} = ?`).join(', ');
  await db.runAsync(`UPDATE tasks SET ${setClause} WHERE id = ?`, [...columns.map((c) => fields[c]), id]);
  return getTaskById(id);
}

export async function deleteTask(id) {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM tasks WHERE id = ?`, [id]);
}

// Marks a task complete and records the estimate-vs-actual delta used by the
// Personalization Engine (Step 3) to update Time Debt / Guilt-Free Bank.
export async function completeTask(id, actualMinutes) {
  const db = await getDatabase();
  const task = await getTaskById(id);
  const delta = actualMinutes - task.estimated_minutes;
  await db.runAsync(
    `UPDATE tasks
     SET status = 'completed', actual_minutes = ?, time_debt_delta = ?, completed_at = datetime('now')
     WHERE id = ?`,
    [actualMinutes, delta, id]
  );
  return getTaskById(id);
}

// ---------------------------------------------------------------------------
// SHIFT TIMELINE
// Shifts one task's day_offset by deltaDays and cascades the same delta to
// every task after it (by order_index) within the same milestone, recomputing
// each one's scheduled_date from the milestone's start_date. This is what
// lets a user drag one task later/earlier and have the rest of the milestone
// follow without manually re-dating each dependent task.
// ---------------------------------------------------------------------------

export async function shiftTaskTimeline(taskId, deltaDays) {
  if (deltaDays === 0) return [];

  const db = await getDatabase();
  const task = await getTaskById(taskId);
  const milestone = await getMilestoneById(task.milestone_id);

  const dependents = await db.getAllAsync(
    `SELECT id, day_offset FROM tasks
     WHERE milestone_id = ? AND order_index >= ?
     ORDER BY order_index`,
    [task.milestone_id, task.order_index]
  );

  await db.withTransactionAsync(async () => {
    for (const dep of dependents) {
      const newOffset = dep.day_offset + deltaDays;
      const newScheduledDate = addDays(milestone.start_date, newOffset);
      await db.runAsync(
        `UPDATE tasks SET day_offset = ?, scheduled_date = ? WHERE id = ?`,
        [newOffset, newScheduledDate, dep.id]
      );
    }
  });

  return getTasksByMilestone(task.milestone_id);
}

// Shifts an entire milestone (its own day_offset/start_date) and cascades to
// every milestone after it within the goal, and to every task inside each
// shifted milestone (their scheduled_date moves with the new start_date, but
// their day_offset relative to the milestone stays the same).
export async function shiftMilestoneTimeline(milestoneId, deltaDays) {
  if (deltaDays === 0) return [];

  const db = await getDatabase();
  const milestone = await getMilestoneById(milestoneId);
  const goal = await getGoalById(milestone.goal_id);

  const dependents = await db.getAllAsync(
    `SELECT id, day_offset FROM milestones
     WHERE goal_id = ? AND order_index >= ?
     ORDER BY order_index`,
    [milestone.goal_id, milestone.order_index]
  );

  await db.withTransactionAsync(async () => {
    for (const dep of dependents) {
      const newOffset = dep.day_offset + deltaDays;
      const newStartDate = addDays(goal.start_date, newOffset);
      await db.runAsync(
        `UPDATE milestones SET day_offset = ?, start_date = ? WHERE id = ?`,
        [newOffset, newStartDate, dep.id]
      );
      // Re-anchor every task under this milestone to the new start_date.
      const tasks = await db.getAllAsync(`SELECT id, day_offset FROM tasks WHERE milestone_id = ?`, [dep.id]);
      for (const t of tasks) {
        const newScheduledDate = addDays(newStartDate, t.day_offset);
        await db.runAsync(`UPDATE tasks SET scheduled_date = ? WHERE id = ?`, [newScheduledDate, t.id]);
      }
    }
  });

  return getMilestonesByGoal(milestone.goal_id);
}
