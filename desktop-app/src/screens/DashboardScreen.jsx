import React, { useCallback, useEffect, useState } from 'react';
import GoalTabs from '../components/GoalTabs.jsx';
import GoalMilestonesView from './GoalMilestonesView.jsx';
import ProofOfCompletionModal from '../components/ProofOfCompletionModal.jsx';
import TimeDebtJustificationModal from '../components/TimeDebtJustificationModal.jsx';
import PunishmentModal from '../components/PunishmentModal.jsx';
import { useTaskCompletion } from '../hooks/useTaskCompletion.js';
import { isUngaBunga, UNGA_BUNGA } from '../lib/tone.js';
import { learnedCapacity, realisticMinutes, dayLoadStatus } from '../lib/behaviorModel.js';

function fmtMinutes(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

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

function AllTasksView({ onOpenGuide, onOpenPrep, tone, onProfileChanged }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('priority'); // 'priority' | 'date'
  const [profile, setProfile] = useState(null);
  const [capacity, setCapacity] = useState(null);

  const refresh = useCallback(async () => {
    const queue = await window.api.tasks.activeQueue();
    setTasks(queue);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Adaptive inputs for the "on your plate" meter: learned daily capacity and
  // the calibration profile (to cost tasks in realistic, not typed, minutes).
  useEffect(() => {
    Promise.all([window.api.profile.load(), window.api.stats.overview()])
      .then(([p, s]) => { setProfile(p); setCapacity(learnedCapacity(s.by_day)); })
      .catch(() => {});
  }, []);

  // Everything due now (scheduled today or already overdue), priced by the
  // learned calibration ratio, vs. the learned daily capacity.
  const todayStr = new Date().toISOString().slice(0, 10);
  const dueNow = tasks.filter((t) => t.scheduled_date && t.scheduled_date <= todayStr);
  const dueMinutes = dueNow.reduce((sum, t) => sum + realisticMinutes(profile, t.effort, t.impact, t.estimated_minutes), 0);
  const loadStatus = capacity ? dayLoadStatus(dueMinutes, capacity) : null;

  // After a completion, refresh the queue AND re-read the profile: a dopamine
  // overrun may have armed the penalty lock, which flips the whole shell.
  const completion = useTaskCompletion(async () => {
    await refresh();
    await onProfileChanged?.();
  });

  // The queue arrives priority-sorted from the DB; offer a chronological view too.
  const displayed = sortBy === 'date'
    ? [...tasks].sort((a, b) => (a.scheduled_date || '9999').localeCompare(b.scheduled_date || '9999') || a.order_index - b.order_index)
    : tasks;

  return (
    <>
      {!loading && tasks.length === 0 && <p className="empty-state">No active tasks. Select a goal above to add milestones, or + Goal to start a new one.</p>}

      {!loading && capacity && dueNow.length > 0 && (
        <div className={`load-meter load-meter-${loadStatus}`}>
          <span className="load-meter-label">On your plate now</span>
          <div className="load-meter-track">
            <div className="load-meter-fill" style={{ width: `${Math.min(100, (dueMinutes / (capacity.avgMinutes * 1.25)) * 100)}%` }} />
          </div>
          <span className="load-meter-value">
            {fmtMinutes(dueMinutes)} vs ~{fmtMinutes(capacity.avgMinutes)}/day
            {loadStatus === 'overloaded' ? ' · over your pace' : ''}
          </span>
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div className="queue-sort">
          <span className="queue-sort-label">Sort:</span>
          <button type="button" className={`queue-sort-btn${sortBy === 'priority' ? ' is-active' : ''}`} onClick={() => setSortBy('priority')}>Priority</button>
          <button type="button" className={`queue-sort-btn${sortBy === 'date' ? ' is-active' : ''}`} onClick={() => setSortBy('date')}>Date</button>
        </div>
      )}

      <div className="task-list">
        {displayed.map((item) => (
          <div className="task-card" key={item.id}>
            <div className="task-card-header">
              <span className="task-card-context">
                {item.goal_title} / {item.milestone_title}
              </span>
              <div className="task-card-tags">
                {item.overdue && <span className="overdue-chip" title="Past its scheduled date">⚠ Overdue</span>}
                {item.slip_risk && <span className="slip-chip" title="You tend to let this type of task slip — it's surfaced earlier">Slip-prone</span>}
                {item.quadrant && <span className="quadrant-chip">{item.quadrant}</span>}
                <Badge effort={item.effort} impact={item.impact} />
              </div>
            </div>
            <div className="task-card-title">{item.title}</div>
            <div className="task-card-footer">
              <span className="task-card-meta">
                {item.scheduled_date ?? 'unscheduled'} - est. {item.estimated_minutes} min
              </span>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button type="button" className="button button-cancel task-guide-button" onClick={() => onOpenPrep(item)}>
                  🧰 Prepare
                </button>
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

export default function DashboardScreen({ selectedGoalId, onSelectGoal, onAddGoal, onAddMilestone, onAddTask, onCapture, onOpenGuide, onOpenInsights, onOpenLeisure, onOpenPrep, onOpenFollowups, onOpenNotes, tone, streaks, onProfileChanged }) {
  const [goals, setGoals] = useState([]);
  const [leisureStatus, setLeisureStatus] = useState(null);
  const [followupCount, setFollowupCount] = useState(0);
  const unga = isUngaBunga(tone);

  // Leisure Loan eligibility + pending follow-up count for the header. Fetched
  // on mount; the dashboard unmounts while sub-flows run, so it re-fetches on
  // return.
  useEffect(() => {
    window.api.profile.leisureStatus().then(setLeisureStatus).catch(() => {});
    window.api.followups.pending().then((f) => setFollowupCount(f.length)).catch(() => {});
  }, []);

  const leisureTitle = leisureStatus?.eligible
    ? `Borrow up to ${leisureStatus.cap_minutes} min of play — repay ${leisureStatus.interest}× as focus`
    : leisureStatus?.reason === 'streak'
    ? `Build a ${leisureStatus.min_streak}-day streak to unlock Leisure Loan`
    : leisureStatus?.reason === 'used_up'
    ? `Used up for today (${leisureStatus.uses_today}/${leisureStatus.max_uses})`
    : leisureStatus?.reason === 'in_progress'
    ? 'A Leisure Loan is already in progress'
    : leisureStatus?.reason === 'locked'
    ? "Can't borrow while you're locked in"
    : 'Leisure Loan';

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
          <button type="button" className="button button-cancel" onClick={onOpenNotes} title="Quick notes, chores & daily reminders">
            📝 Notes
          </button>
          <button type="button" className="button button-cancel" onClick={onOpenFollowups} title="Answer the app's check-ins (submitted? replied?)">
            🧾 Follow-ups{followupCount > 0 ? ` (${followupCount})` : ''}
          </button>
          <button type="button" className="button button-cancel" onClick={onOpenInsights} title="See your stats, time economy, and history">
            📊 Insights
          </button>
          <button
            type="button"
            className={`button button-cancel tone-toggle${unga ? ' tone-toggle-on' : ''}`}
            onClick={toggleTone}
            title="Switch between Encouraging and Lock In tone"
          >
            {unga ? '🔒 Lock In: ON' : '🔒 Lock In: OFF'}
          </button>
          <button
            type="button"
            className="button button-cancel"
            onClick={onOpenLeisure}
            disabled={!leisureStatus?.eligible}
            title={leisureTitle}
          >
            🎮 Leisure Loan
          </button>
          <button type="button" className="button button-danger" onClick={goUngaBunga} title="Lock onto one task, hide everything else">
            Lock In now
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
        <AllTasksView onOpenGuide={onOpenGuide} onOpenPrep={onOpenPrep} tone={tone} onProfileChanged={onProfileChanged} />
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