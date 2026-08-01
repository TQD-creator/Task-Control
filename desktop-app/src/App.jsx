// Top-level screen switcher. selectedGoalId is lifted up here (rather than
// living in DashboardScreen) so it survives navigating away to New
// Milestone/New Task and back — the Dashboard would otherwise remount and
// forget which goal tag was selected.
//
// The profile (tone + focus_lock) is also loaded here: when focus_lock.active,
// the entire normal UI is replaced by FocusLockScreen (Unga Bunga single-task
// lockdown) — the one exception is the per-task Guide, which stays reachable.

import React, { useCallback, useEffect, useState } from 'react';
import DashboardScreen from './screens/DashboardScreen.jsx';
import NewGoalScreen from './screens/NewGoalScreen.jsx';
import NewMilestoneScreen from './screens/NewMilestoneScreen.jsx';
import NewTaskScreen from './screens/NewTaskScreen.jsx';
import CaptureScreen from './screens/CaptureScreen.jsx';
import CaptureReviewScreen from './screens/CaptureReviewScreen.jsx';
import GuideScreen from './screens/GuideScreen.jsx';
import FocusLockScreen from './screens/FocusLockScreen.jsx';
import InsightsScreen from './screens/InsightsScreen.jsx';
import LeisureLoanScreen from './screens/LeisureLoanScreen.jsx';
import PrepScreen from './screens/PrepScreen.jsx';
import FollowUpsInbox from './screens/FollowUpsInbox.jsx';
import NotesScreen from './screens/NotesScreen.jsx';

export default function App() {
  const [screen, setScreen] = useState({ name: 'dashboard' });
  const [selectedGoalId, setSelectedGoalId] = useState(null); // null = "All" tag
  const [profile, setProfile] = useState(null);

  const reloadProfile = useCallback(async () => {
    setProfile(await window.api.profile.load());
  }, []);

  useEffect(() => {
    reloadProfile();
  }, [reloadProfile]);

  // Main can ask us to switch screens (a notification click → the right place).
  useEffect(() => {
    return window.api.onNavigate((target) => {
      if (target === 'followups') setScreen({ name: 'followups' });
      else if (target === 'chores') setScreen({ name: 'notes', tab: 'chores' });
      else if (target === 'notes') setScreen({ name: 'notes', tab: 'notes' });
    });
  }, []);

  const tone = profile?.personalization?.tone_preference ?? 'encouraging';
  const focusLock = profile?.focus_lock;

  // The single-task lockdown replaces everything — except the Guide screen, so a
  // locked-in task can still pull up its step-by-step guide.
  if (focusLock?.active && screen.name !== 'guide') {
    return (
      <div className="app">
        <FocusLockScreen
          lock={focusLock}
          tone={tone}
          onChanged={reloadProfile}
          onOpenGuide={(task) => setScreen({ name: 'guide', taskId: task.id, taskTitle: task.title })}
        />
      </div>
    );
  }

  return (
    <div className="app">
      {screen.name === 'dashboard' && (
        <DashboardScreen
          selectedGoalId={selectedGoalId}
          onSelectGoal={setSelectedGoalId}
          onAddGoal={() => setScreen({ name: 'newGoal' })}
          onAddMilestone={(goalId) => setScreen({ name: 'newMilestone', goalId })}
          onAddTask={(milestoneId) => setScreen({ name: 'newTask', milestoneId })}
          onCapture={() => setScreen({ name: 'capture' })}
          onOpenGuide={(task) => setScreen({ name: 'guide', taskId: task.id, taskTitle: task.title })}
          onOpenInsights={() => setScreen({ name: 'insights' })}
          onOpenLeisure={() => setScreen({ name: 'leisure' })}
          onOpenPrep={(task) => setScreen({ name: 'prep', task })}
          onOpenFollowups={() => setScreen({ name: 'followups' })}
          onOpenNotes={() => setScreen({ name: 'notes', tab: 'notes' })}
          tone={tone}
          streaks={profile?.streaks}
          onProfileChanged={reloadProfile}
        />
      )}

      {screen.name === 'prep' && (
        <PrepScreen
          task={screen.task}
          tone={tone}
          onBack={() => setScreen({ name: 'dashboard' })}
          onChanged={reloadProfile}
        />
      )}

      {screen.name === 'followups' && (
        <FollowUpsInbox
          tone={tone}
          onBack={() => setScreen({ name: 'dashboard' })}
          onChanged={reloadProfile}
        />
      )}

      {screen.name === 'notes' && (
        <NotesScreen
          initialTab={screen.tab || 'notes'}
          onBack={() => setScreen({ name: 'dashboard' })}
          onOpenPlan={(initialText) => setScreen({ name: 'capture', initialText })}
        />
      )}

      {screen.name === 'insights' && (
        <InsightsScreen tone={tone} onBack={() => { reloadProfile(); setScreen({ name: 'dashboard' }); }} />
      )}

      {screen.name === 'leisure' && (
        <LeisureLoanScreen
          tone={tone}
          onChanged={reloadProfile}
          onExit={() => setScreen({ name: 'dashboard' })}
        />
      )}

      {screen.name === 'newGoal' && (
        <NewGoalScreen
          onCancel={() => setScreen({ name: 'dashboard' })}
          onSave={(goal) => {
            setSelectedGoalId(goal.id);
            setScreen({ name: 'newMilestone', goalId: goal.id });
          }}
        />
      )}

      {screen.name === 'newMilestone' && (
        <NewMilestoneScreen
          goalId={screen.goalId}
          onCancel={() => setScreen({ name: 'dashboard' })}
          onSave={() => {
            setSelectedGoalId(screen.goalId);
            setScreen({ name: 'dashboard' });
          }}
        />
      )}

      {screen.name === 'newTask' && (
        <NewTaskScreen
          milestoneId={screen.milestoneId}
          onCancel={() => setScreen({ name: 'dashboard' })}
          onSave={() => setScreen({ name: 'dashboard' })}
        />
      )}

      {screen.name === 'capture' && (
        <CaptureScreen
          initialText={screen.initialText || ''}
          onCancel={() => setScreen({ name: 'dashboard' })}
          onAnalyzed={(analysis) => setScreen({ name: 'captureReview', analysis })}
        />
      )}

      {screen.name === 'captureReview' && (
        <CaptureReviewScreen
          analysis={screen.analysis}
          onCancel={() => setScreen({ name: 'dashboard' })}
          onSaved={(goal) => {
            setSelectedGoalId(goal.id);
            setScreen({ name: 'dashboard' });
          }}
        />
      )}

      {screen.name === 'guide' && (
        <GuideScreen
          taskId={screen.taskId}
          taskTitle={screen.taskTitle}
          onBack={() => setScreen({ name: 'dashboard' })}
        />
      )}
    </div>
  );
}
