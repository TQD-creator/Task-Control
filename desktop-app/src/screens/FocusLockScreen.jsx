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
//   - 'leisure_loan' (Leisure Loan)     -> no exit; a live countdown to
//                                          lock.expires_at. Completing the task
//                                          early releases it; otherwise it
//                                          auto-releases when the clock runs out
//                                          (profileEngine.finishLeisureLoan).

import React, { useCallback, useEffect, useState } from 'react';
import ProofOfCompletionModal from '../components/ProofOfCompletionModal.jsx';
import TimeDebtJustificationModal from '../components/TimeDebtJustificationModal.jsx';
import PunishmentModal from '../components/PunishmentModal.jsx';
import { useTaskCompletion } from '../hooks/useTaskCompletion.js';
import { isUngaBunga } from '../lib/tone.js';

function fmtClock(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, '0');
  return `${m}:${sec}`;
}

export default function FocusLockScreen({ lock, tone, onChanged, onOpenGuide }) {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const penalty = lock.reason === 'penalty';
  const leisure = lock.reason === 'leisure_loan';
  const [remaining, setRemaining] = useState(null);

  const refreshQueue = useCallback(async () => {
    setQueue(await window.api.tasks.activeQueue());
  }, []);

  useEffect(() => {
    refreshQueue().finally(() => setLoading(false));
  }, [refreshQueue]);

  // Leisure-loan repayment: tick a live countdown to expires_at; when it hits
  // zero, finalize the loan (which clears the lock) and refresh. Wall-clock, so
  // it's naturally correct across a sleep — the load-time sweep is the backstop.
  useEffect(() => {
    if (!leisure || !lock.expires_at) { setRemaining(null); return undefined; }
    const end = new Date(lock.expires_at).getTime();
    let done = false;
    const tick = async () => {
      const left = Math.round((end - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0 && !done) {
        done = true;
        await window.api.profile.leisureFinish();
        await onChanged();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { done = true; clearInterval(id); };
  }, [leisure, lock.expires_at, onChanged]);

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
    } else if (leisure) {
      // Finishing the borrowed-focus task early satisfies the repayment — unless
      // the completion itself just armed a penalty, which must stand.
      if (!penaltyArmed) await window.api.profile.leisureFinish();
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
        {leisure && (
          <div className="focus-lock-repay">
            <span className="focus-lock-repay-label">Repaying borrowed play</span>
            <span className="focus-lock-repay-clock">{remaining != null ? fmtClock(remaining) : '…'}</span>
          </div>
        )}
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

            {leisure ? (
              <div className="focus-lock-note focus-lock-note-leisure">
                Borrowed play is being repaid. Finish the task to clear it early.
              </div>
            ) : penalty ? (
              <div className="focus-lock-note focus-lock-note-penalty">
                Locked until tomorrow. Execution is the only way out.
              </div>
            ) : (
              <button type="button" className="focus-lock-standdown" onClick={standDown}>
                Stand down
              </button>
            )}
          </>
        ) : leisure ? (
          // Repayment lock whose task vanished (deleted/completed elsewhere).
          // Don't offer the picker — re-arming via setFocusLock would drop
          // expires_at and strand the lock. The countdown clears it at zero.
          <>
            <div className="focus-lock-eyebrow">The bill has come due.</div>
            <h1 className="focus-lock-title">Your borrowed play is being repaid.</h1>
            <p className="focus-lock-empty">
              That task is no longer available — the repayment clock keeps running and clears itself at zero.
            </p>
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
