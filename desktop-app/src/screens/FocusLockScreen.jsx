// The "Go Unga Bunga" single-task lockdown (spec C + the penalty side of E).
//
// When focus_lock.active, the whole dashboard is replaced by this screen so the
// brain never gets the overwhelming dimension of *time* — no goals, milestones,
// dates, or other tasks. Exactly one thing is visible.
//
//   - lock.task_id not chosen (or the chosen task is done/gone) -> a stark
//     chooser: pick the ONE thing to lock onto.
//   - lock.task_id chosen        -> only that task, with Complete / Timer / Guide.
//
// Reasons differ on how you leave:
//   - 'manual'  (Go Unga Bunga toggle)  -> "Stand down" clears it; completing the
//                                          task also returns you to the dashboard.
//   - 'penalty' (dopamine overrun)      -> no exit; locked until tomorrow. The
//                                          lock auto-clears next day on load
//                                          (profileEngine.normalizeProfile).

import React, { useCallback, useEffect, useState } from 'react';
import ProofOfCompletionModal from '../components/ProofOfCompletionModal.jsx';
import TimeDebtJustificationModal from '../components/TimeDebtJustificationModal.jsx';
import PunishmentModal from '../components/PunishmentModal.jsx';
import { useTaskCompletion } from '../hooks/useTaskCompletion.js';
import { isUngaBunga } from '../lib/tone.js';

export default function FocusLockScreen({ lock, tone, onChanged, onOpenGuide }) {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const penalty = lock.reason === 'penalty';

  const refreshQueue = useCallback(async () => {
    setQueue(await window.api.tasks.activeQueue());
  }, []);

  useEffect(() => {
    refreshQueue().finally(() => setLoading(false));
  }, [refreshQueue]);

  // Completing the locked task. This callback runs AFTER any punishment menu is
  // served, so the on-disk lock already reflects a punishment that armed one —
  // re-read it fresh rather than trusting the pre-punishment completion result.
  //   - penalty lock: holds until tomorrow; re-arm with no task so the next
  //     thing is forced (the completed task drops out of the queue anyway).
  //   - manual lock: completing the one task releases it — unless a punishment
  //     just armed the penalty lock, which must stand.
  const completion = useTaskCompletion(async () => {
    const fresh = await window.api.profile.load();
    const penaltyArmed = fresh?.focus_lock?.active && fresh.focus_lock.reason === 'penalty';
    if (penalty) {
      if (!penaltyArmed) await window.api.profile.setFocusLock(null, 'penalty');
    } else if (!penaltyArmed) {
      await window.api.profile.clearFocusLock();
    }
    await refreshQueue();
    await onChanged();
  });

  async function pick(taskId) {
    await window.api.profile.setFocusLock(taskId, lock.reason);
    await onChanged();
  }

  async function standDown() {
    await window.api.profile.clearFocusLock();
    await onChanged();
  }

  const focusTask = lock.task_id != null ? queue.find((t) => t.id === lock.task_id) : null;

  if (loading) return <div className="focus-lock" />;

  return (
    <div className={`focus-lock${isUngaBunga(tone) ? ' focus-lock-unga' : ''}`}>
      <div className="focus-lock-inner">
        {focusTask ? (
          <>
            <div className="focus-lock-eyebrow">One thing. Nothing else.</div>
            <h1 className="focus-lock-title">{focusTask.title}</h1>
            {(focusTask.action || focusTask.artifact) && (
              <p className="focus-lock-artifact">
                {[focusTask.action, focusTask.artifact].filter(Boolean).join(' → ')}
              </p>
            )}

            <div className="focus-lock-actions">
              <button
                type="button"
                className="button button-complete"
                onClick={() => completion.setProofTask(focusTask)}
              >
                Complete
              </button>
              <button
                type="button"
                className="button"
                onClick={() => window.api.timer.openWidget(focusTask.milestone_id)}
              >
                ⏱ Timer
              </button>
              <button type="button" className="button button-cancel" onClick={() => onOpenGuide(focusTask)}>
                📖 Guide
              </button>
            </div>

            {penalty ? (
              <div className="focus-lock-note focus-lock-note-penalty">
                Locked until tomorrow. Execution is the only way out.
              </div>
            ) : (
              <button type="button" className="focus-lock-standdown" onClick={standDown}>
                Stand down
              </button>
            )}
          </>
        ) : (
          <>
            <div className="focus-lock-eyebrow">
              {penalty ? 'You surrendered to dopamine. Locked in.' : 'Pick the one thing.'}
            </div>
            <h1 className="focus-lock-title">
              {penalty ? 'Choose what you execute next.' : 'What is the single highest-impact thing?'}
            </h1>

            {queue.length === 0 ? (
              <p className="focus-lock-empty">
                Nothing left in the queue.{' '}
                {penalty ? 'Still locked until tomorrow.' : (
                  <button type="button" className="focus-lock-standdown" onClick={standDown}>
                    Stand down
                  </button>
                )}
              </p>
            ) : (
              <div className="focus-lock-choices">
                {queue.map((t) => (
                  <button key={t.id} type="button" className="focus-lock-choice" onClick={() => pick(t.id)}>
                    {t.title}
                  </button>
                ))}
              </div>
            )}

            {!penalty && queue.length > 0 && (
              <button type="button" className="focus-lock-standdown" onClick={standDown}>
                Stand down
              </button>
            )}
          </>
        )}
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
    </div>
  );
}
