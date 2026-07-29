// Per-goal view: every Milestone under this Goal, each with its own Tasks
// listed underneath (including already-completed ones, so you can see
// progress, not just what's left). This is what actually answers "did my
// goal/milestone save?" — unlike the flat Dashboard queue, it shows
// milestones even before they have any tasks yet.

import React, { useCallback, useEffect, useState } from 'react';
import ProofOfCompletionModal from '../components/ProofOfCompletionModal.jsx';
import TimeDebtJustificationModal from '../components/TimeDebtJustificationModal.jsx';
import PunishmentModal from '../components/PunishmentModal.jsx';
import { useTaskCompletion } from '../hooks/useTaskCompletion.js';

const EFFORT_IMPACT_COLORS = {
  'low-low': '#9ca3af',
  'low-high': '#16a34a',
  'high-low': '#f59e0b',
  'high-high': '#2563eb',
};

function Badge({ effort, impact }) {
  const color = EFFORT_IMPACT_COLORS[`${effort}-${impact}`];
  return (
    <span className="badge" style={{ backgroundColor: color }}>
      {effort}/{impact}
    </span>
  );
}

export default function GoalMilestonesView({ goalId, onAddMilestone, onAddTask, onGoalRenamed, onOpenGuide, tone, onProfileChanged }) {
  const [goal, setGoal] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [tasksByMilestone, setTasksByMilestone] = useState({});
  const [loading, setLoading] = useState(true);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  const refresh = useCallback(async () => {
    const [goalData, milestoneRows] = await Promise.all([
      window.api.goals.get(goalId),
      window.api.milestones.listByGoal(goalId),
    ]);
    setGoal(goalData);
    setMilestones(milestoneRows);

    const taskLists = await Promise.all(milestoneRows.map((m) => window.api.tasks.listByMilestone(m.id)));
    const map = {};
    milestoneRows.forEach((m, i) => { map[m.id] = taskLists[i]; });
    setTasksByMilestone(map);
  }, [goalId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const completion = useTaskCompletion(async () => {
    await refresh();
    await onProfileChanged?.(); // a dopamine overrun may arm the penalty lock
  });

  function startEditingTitle() {
    setTitleDraft(goal.title);
    setIsEditingTitle(true);
  }

  async function saveTitle() {
    const trimmed = titleDraft.trim();
    if (!trimmed || savingTitle) return;
    setSavingTitle(true);
    try {
      const updated = await window.api.goals.update(goalId, { title: trimmed });
      setGoal(updated);
      setIsEditingTitle(false);
      await onGoalRenamed?.(); // re-syncs the goal tag chip's label
    } finally {
      setSavingTitle(false);
    }
  }

  if (loading) return <div className="container">Loading...</div>;
  if (!goal) return <div className="container">Goal not found.</div>;

  return (
    <div className="container">
      {isEditingTitle ? (
        <div className="goal-title-edit">
          <input
            className="input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') setIsEditingTitle(false);
            }}
          />
          <button type="button" className="button button-cancel" onClick={() => setIsEditingTitle(false)}>
            Cancel
          </button>
          <button type="button" className="button button-save" disabled={!titleDraft.trim() || savingTitle} onClick={saveTitle}>
            {savingTitle ? 'Saving...' : 'Save'}
          </button>
        </div>
      ) : (
        <h1 className="heading goal-title-row" style={{ marginBottom: 4 }}>
          {goal.title}
          <button type="button" className="goal-title-edit-icon" title="Rename goal" onClick={startEditingTitle}>
            ✏️
          </button>
        </h1>
      )}
      {goal.action && goal.artifact && (
        <p className="section-label" style={{ marginTop: 0 }}>{goal.action} {goal.artifact}</p>
      )}

      {milestones.length === 0 && <p className="empty-state">No milestones yet.</p>}

      {milestones.map((milestone) => (
        <div className="milestone-block" key={milestone.id}>
          <div className="milestone-block-header">
            <div>
              <div className="milestone-block-title">{milestone.title}</div>
              <div className="task-card-meta">{milestone.start_date ?? 'unscheduled'}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="button button-cancel task-add-button"
                style={{ marginTop: 0 }}
                title="Open the floating timer for this milestone"
                onClick={() => window.api.timer.openWidget(milestone.id)}
              >
                ⏱ Timer
              </button>
              <Badge effort={milestone.effort} impact={milestone.impact} />
            </div>
          </div>

          <div className="task-sublist">
            {(tasksByMilestone[milestone.id] ?? []).map((task) => (
              <div className="task-row" key={task.id}>
                <div>
                  <span className={`task-row-title${task.status === 'completed' ? ' completed' : ''}`}>{task.title}</span>
                  <span className="task-card-meta"> · est. {task.estimated_minutes} min</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="button button-cancel task-guide-button"
                    title="Generate a step-by-step web guide for this task"
                    onClick={() => onOpenGuide(task)}
                  >
                    📖 Guide
                  </button>
                  {task.status === 'completed' ? (
                    <span className="badge task-guide-button" style={{ backgroundColor: '#9ca3af' }}>done</span>
                  ) : (
                    <button type="button" className="button button-complete task-guide-button" onClick={() => completion.setProofTask(task)}>
                      Complete
                    </button>
                  )}
                </div>
              </div>
            ))}
            {(tasksByMilestone[milestone.id] ?? []).length === 0 && (
              <p className="empty-state" style={{ margin: '8px 0' }}>No tasks yet.</p>
            )}
          </div>

          <button type="button" className="button button-cancel task-add-button" onClick={() => onAddTask(milestone.id)}>
            + Task
          </button>
        </div>
      ))}

      <button type="button" className="button button-save" onClick={onAddMilestone} style={{ marginTop: 16 }}>
        + Milestone
      </button>

      <ProofOfCompletionModal
        visible={!!completion.proofTask && !completion.pendingCompletion}
        task={completion.proofTask}
        onSubmit={completion.handleProofSubmit}
        onClose={() => completion.setProofTask(null)}
      />

      <TimeDebtJustificationModal
        visible={!!completion.pendingCompletion}
        overrunMinutes={completion.overrunMinutes}
        tone={tone}
        onSubmit={completion.handleJustificationSubmit}
        onBack={completion.handleJustificationBack}
      />

      <PunishmentModal
        visible={!!completion.punishmentOptions}
        options={completion.punishmentOptions}
        onServe={completion.serve}
      />
    </div>
  );
}