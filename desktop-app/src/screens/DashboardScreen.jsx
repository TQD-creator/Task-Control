import React, { useCallback, useEffect, useState } from 'react';
import GoalTabs from '../components/GoalTabs.jsx';
import GoalMilestonesView from './GoalMilestonesView.jsx';
import ProofOfCompletionModal from '../components/ProofOfCompletionModal.jsx';
import TimeDebtJustificationModal from '../components/TimeDebtJustificationModal.jsx';
import PunishmentModal from '../components/PunishmentModal.jsx';
import { useTaskCompletion } from '../hooks/useTaskCompletion.js';
import { isUngaBunga, UNGA_BUNGA } from '../lib/tone.js';

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

function AllTasksView({ onOpenGuide, tone, onProfileChanged }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const queue = await window.api.tasks.activeQueue();
    setTasks(queue);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // After a completion, refresh the queue AND re-read the profile: a dopamine
  // overrun may have armed the penalty lock, which flips the whole shell.
  const completion = useTaskCompletion(async () => {
    await refresh();
    await onProfileChanged?.();
  });

  return (
    <>
      {!loading && tasks.length === 0 && <p className="empty-state">No active tasks. Select a goal above to add milestones, or + Goal to start a new one.</p>}

      <div className="task-list">
        {tasks.map((item) => (
          <div className="task-card" key={item.id}>
            <div className="task-card-header">
              <span className="task-card-context">
                {item.goal_title} / {item.milestone_title}
              </span>
              <Badge effort={item.effort} impact={item.impact} />
            </div>
            <div className="task-card-title">{item.title}</div>
            <div className="task-card-footer">
              <span className="task-card-meta">
                {item.scheduled_date ?? 'unscheduled'} - est. {item.estimated_minutes} min
              </span>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button type="button" className="button button-cancel task-guide-button" onClick={() => onOpenGuide(item)}>
                  📖 Guide
                </button>
                <button type="button" className="button button-complete task-guide-button" onClick={() => completion.setProofTask(item)}>
                  Complete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

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
    </>
  );
}

export default function DashboardScreen({ selectedGoalId, onSelectGoal, onAddGoal, onAddMilestone, onAddTask, onCapture, onOpenGuide, tone, streaks, onProfileChanged }) {
  const [goals, setGoals] = useState([]);
  const unga = isUngaBunga(tone);

  const refreshGoals = useCallback(async () => {
    setGoals(await window.api.goals.list());
  }, []);

  useEffect(() => {
    refreshGoals();
  }, [refreshGoals]);

  async function handleTogglePin(goalId, pinned) {
    await window.api.goals.update(goalId, { is_pinned: pinned ? 1 : 0 });
    await refreshGoals(); // pin order changes, so re-sort from the source of truth
  }

  // Flip the tone between encouraging and Unga Bunga (persists to the profile).
  async function toggleTone() {
    await window.api.profile.setTone(unga ? 'encouraging' : UNGA_BUNGA);
    await onProfileChanged?.();
  }

  // "Go Unga Bunga": arm a manual single-task lock with no task chosen yet, so
  // FocusLockScreen opens straight into its pick-one-thing chooser.
  async function goUngaBunga() {
    await window.api.profile.setFocusLock(null, 'manual');
    await onProfileChanged?.();
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="dashboard-header">
        <h1 className="heading" style={{ margin: 0 }}>{selectedGoalId === null ? "Today's Queue" : 'Goal'}</h1>
        <div className="dashboard-header-tools">
          {unga && streaks && (
            <span className="streak-chip" title="Consistency is the only reward. Keep the streak alive.">
              🔥 {streaks.current_streak_days}-day streak
            </span>
          )}
          <button
            type="button"
            className={`button button-cancel tone-toggle${unga ? ' tone-toggle-on' : ''}`}
            onClick={toggleTone}
            title="Switch between encouraging and Unga Bunga tone"
          >
            {unga ? '🦣 Unga Bunga: ON' : '🦣 Unga Bunga: OFF'}
          </button>
          <button type="button" className="button button-danger" onClick={goUngaBunga} title="Lock onto one task, hide everything else">
            Go Unga Bunga
          </button>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 0, paddingBottom: 0 }}>
        <GoalTabs
          goals={goals}
          selectedGoalId={selectedGoalId}
          onSelect={onSelectGoal}
          onAddGoal={onAddGoal}
          onTogglePin={handleTogglePin}
          onCapture={onCapture}
        />
      </div>

      {selectedGoalId === null ? (
        <AllTasksView onOpenGuide={onOpenGuide} tone={tone} onProfileChanged={onProfileChanged} />
      ) : (
        <GoalMilestonesView
          goalId={selectedGoalId}
          onAddMilestone={() => onAddMilestone(selectedGoalId)}
          onAddTask={onAddTask}
          onOpenGuide={onOpenGuide}
          onGoalRenamed={refreshGoals}
          tone={tone}
          onProfileChanged={onProfileChanged}
        />
      )}
    </div>
  );
}