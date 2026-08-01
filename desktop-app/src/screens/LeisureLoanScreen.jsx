// Leisure Loan — borrow play time now, repay as forced focus (1.25x) after.
//
// This screen owns the first two phases of the loan; the third (repayment) is a
// timed focus lock that App.jsx swaps to automatically once it's armed.
//
//   form  -> pick a task + minutes, see the interest, borrow.
//   play  -> a countdown of your borrowed free time (a permission window; the
//            app doesn't police what you do). "Start prep now" skips ahead.
//   prep  -> a short "get your tools ready" buffer showing the task, then
//            "Start focus now" arms the repayment lock (App takes over).
//
// There is no cancel once you've borrowed: the repayment is owed. Closing the
// app mid-play doesn't dodge it — the load-time sweep arms the lock on reopen.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { copy, isUngaBunga } from '../lib/tone.js';

function fmtClock(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, '0');
  return `${m}:${sec}`;
}

export default function LeisureLoanScreen({ tone, onChanged, onExit }) {
  const [status, setStatus] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [minutes, setMinutes] = useState(10);
  const [taskId, setTaskId] = useState(null);
  const [error, setError] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const advancing = useRef(false);

  const refresh = useCallback(async () => {
    const [st, queue] = await Promise.all([
      window.api.profile.leisureStatus(),
      window.api.tasks.activeQueue(),
    ]);
    setStatus(st);
    setTasks(queue);
    setMinutes((m) => Math.min(Math.max(5, m), st.cap_minutes));
    setTaskId((cur) => cur ?? (queue[0]?.id ?? null));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // 1s tick that drives the play/prep countdowns.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const active = status?.active || null;
  const phase = active?.phase || 'form';
  const secondsLeft = (iso) => (iso ? Math.round((new Date(iso).getTime() - nowMs) / 1000) : null);
  const playLeft = phase === 'play' ? secondsLeft(active.play_ends_at) : null;
  const prepLeft = phase === 'prep' ? secondsLeft(active.prep_ends_at) : null;

  const beginPrep = useCallback(async () => {
    if (advancing.current) return;
    advancing.current = true;
    await window.api.profile.leisureBeginPrep();
    advancing.current = false;
    await refresh();
  }, [refresh]);

  const beginRepay = useCallback(async () => {
    if (advancing.current) return;
    advancing.current = true;
    await window.api.profile.leisureBeginRepay();
    // The repayment lock is now armed; App swaps to FocusLockScreen on reload.
    // Reset the underlying screen to the dashboard so that when the lock later
    // clears we land there, not back on the borrow form.
    await onChanged();
    onExit();
  }, [onChanged, onExit]);

  // Auto-advance when a window runs out.
  useEffect(() => {
    if (phase === 'play' && playLeft != null && playLeft <= 0) beginPrep();
  }, [phase, playLeft, beginPrep]);
  useEffect(() => {
    if (phase === 'prep' && prepLeft != null && prepLeft <= 0) beginRepay();
  }, [phase, prepLeft, beginRepay]);

  async function borrow() {
    setError(null);
    const res = await window.api.profile.leisureStart(minutes, taskId);
    if (!res.ok) {
      setError(
        res.reason === 'streak' ? 'You need a longer streak to borrow.'
        : res.reason === 'used_up' ? "You've used your Leisure Loan for today."
        : res.reason === 'in_progress' ? 'A loan is already in progress.'
        : res.reason === 'locked' ? "You can't borrow while locked in."
        : 'Could not start the loan.'
      );
      return;
    }
    await refresh();
  }

  if (!status) return <div className="leisure-screen" />;

  const unga = isUngaBunga(tone);
  const owe = Math.ceil(minutes * status.interest);
  const chosenTask = active ? tasks.find((t) => t.id === active.task_id) : null;

  return (
    <div className={`leisure-screen${unga ? ' leisure-screen-unga' : ''}`}>
      <div className="leisure-inner">
        {phase === 'form' && (
          <>
            <div className="leisure-eyebrow">Leisure Loan</div>
            <h1 className="leisure-title">{copy(tone, 'leisureHeading')}</h1>
            <p className="leisure-body">{copy(tone, 'leisureBody')}</p>

            {tasks.length === 0 ? (
              <p className="leisure-note">Add a task first — you borrow against work you'll do next.</p>
            ) : (
              <>
                <label className="leisure-field">
                  <span>Work on next</span>
                  <select value={taskId ?? ''} onChange={(e) => setTaskId(Number(e.target.value))}>
                    {tasks.map((t) => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))}
                  </select>
                </label>

                <label className="leisure-field">
                  <span>Play time: <strong>{minutes} min</strong></span>
                  <input
                    type="range"
                    min={5}
                    max={status.cap_minutes}
                    step={5}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                  <span className="leisure-range-caps">
                    <span>5</span><span>max {status.cap_minutes}</span>
                  </span>
                </label>

                <div className="leisure-owe">
                  You'll owe <strong>{owe} min</strong> of forced focus ({status.interest}× interest),
                  starting right after your break.
                </div>

                {error && <div className="leisure-error">{error}</div>}

                <div className="leisure-actions">
                  <button type="button" className="button button-cancel" onClick={onExit}>Not now</button>
                  <button type="button" className="button button-save" onClick={borrow}>
                    Borrow {minutes} min
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {phase === 'play' && (
          <>
            <div className="leisure-eyebrow">{copy(tone, 'leisurePlayHeading')}</div>
            <div className="leisure-clock">{fmtClock(playLeft ?? 0)}</div>
            <p className="leisure-body">
              Enjoy it — you'll owe <strong>{active.repay_minutes} min</strong> of focus when it ends.
            </p>
            <div className="leisure-actions">
              <button type="button" className="button" onClick={beginPrep}>Start prep now</button>
            </div>
          </>
        )}

        {phase === 'prep' && (
          <>
            <div className="leisure-eyebrow">{copy(tone, 'leisurePrepHeading')}</div>
            <div className="leisure-clock leisure-clock-prep">{fmtClock(prepLeft ?? 0)}</div>
            {chosenTask ? (
              <>
                <h1 className="leisure-title">{chosenTask.title}</h1>
                {(chosenTask.action || chosenTask.artifact) && (
                  <p className="leisure-artifact">
                    {[chosenTask.action, chosenTask.artifact].filter(Boolean).join(' → ')}
                  </p>
                )}
              </>
            ) : (
              <h1 className="leisure-title">Get ready to focus.</h1>
            )}
            <p className="leisure-body">
              Gather what you need. When you're ready (or the timer ends), the {active.repay_minutes}-minute
              focus lock begins.
            </p>
            <div className="leisure-actions">
              <button type="button" className="button button-save" onClick={beginRepay}>
                {copy(tone, 'leisureStart')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
