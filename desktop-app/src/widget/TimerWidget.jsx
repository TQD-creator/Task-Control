// The floating, always-on-top Milestone & Task Timer widget.
//
// Layout (top -> bottom):
//   1. Clock — big digital time for the active task; a toggle switches between
//      the current SESSION time and the task's TOTAL overall time. In "Tanking
//      Boredom" mode it instead counts the resistance session.
//   2. Header — the current milestone's name.
//   3. Task list — a contextual window of at most 5 rows: up to 2 completed
//      (gray, struck through), the 1 active task (bold green), up to 2 pending
//      (normal). Clicking any not-yet-done row starts timing it.
//   4. Controls — Play, Pause, Close + a "Tanking Boredom" toggle.
//
// All timing logic/authority is in the main process; this component only reads
// snapshots from the store and sends play/pause/close/boredom commands. In Unga
// Bunga tone, Pause and Close first confront the urge to quit instead of
// obeying it immediately.

import React, { useEffect, useState } from 'react';
import { useTimerStore, initTimerStore } from './timerStore.js';
import { copy, isUngaBunga } from '../lib/tone.js';

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Live session seconds derived from the authoritative snapshot. While running
// we count up from startedAt; while paused we show the last session's length.
function liveSessionSeconds(snapshot) {
  if (snapshot.running && snapshot.startedAt) {
    return (Date.now() - snapshot.startedAt) / 1000;
  }
  return snapshot.lastSessionSeconds;
}

// Live seconds of the current boredom-tanking session.
function liveBoredomSeconds(snapshot) {
  if (snapshot.mode === 'boredom' && snapshot.boredomStartedAt) {
    return (Date.now() - snapshot.boredomStartedAt) / 1000;
  }
  return 0;
}

// Pick the contextual (max 5) window of tasks to show around the active one.
function buildTaskView(tasks, activeTaskId) {
  const active = activeTaskId != null ? tasks.find((t) => t.id === activeTaskId) : null;
  // Exclude the active task from BOTH lists: if it gets completed elsewhere
  // while still active, it must not appear as a gray-struck completed row AND
  // the bold-green active row at the same time.
  const completed = tasks.filter((t) => t.status === 'completed' && t.id !== activeTaskId);
  const pending = tasks.filter((t) => t.status !== 'completed' && t.id !== activeTaskId);

  if (active) {
    const doneBefore = completed.filter((t) => t.order_index < active.order_index);
    const pendingAfter = pending.filter((t) => t.order_index > active.order_index);
    return {
      completed: (doneBefore.length ? doneBefore : completed).slice(-2),
      active,
      pending: (pendingAfter.length ? pendingAfter : pending).slice(0, 2),
    };
  }
  return { completed: completed.slice(-2), active: null, pending: pending.slice(0, 2) };
}

export default function TimerWidget() {
  useEffect(() => {
    initTimerStore();
  }, []);

  const store = useTimerStore();
  const { snapshot, milestone, tasks, displayMode, tone } = store;
  const unga = isUngaBunga(tone);

  // 'pause' | 'close' | null — which action the Unga Bunga confrontation is
  // holding back until the user either stands steady or surrenders anyway.
  const [confront, setConfront] = useState(null);

  const boredomMode = snapshot.mode === 'boredom';
  const view = buildTaskView(tasks, snapshot.activeTaskId);
  const session = liveSessionSeconds(snapshot);
  const clockValue = boredomMode
    ? liveBoredomSeconds(snapshot)
    : displayMode === 'total'
      ? snapshot.baseTotalSeconds + session
      : session;

  // Bottom Play resumes the active (paused) task, or starts the first pending
  // one if nothing is active yet.
  function handlePlay() {
    if (snapshot.activeTaskId != null) {
      store.play(snapshot.activeTaskId);
    } else if (view.pending[0]) {
      store.play(view.pending[0].id);
    }
  }

  // Pause / Close confront the urge in Unga Bunga tone before acting.
  function requestPause() {
    if (unga && snapshot.running) setConfront('pause');
    else store.pause();
  }
  function requestClose() {
    if (unga && (snapshot.running || boredomMode)) setConfront('close');
    else store.close();
  }
  function surrender() {
    if (confront === 'pause') store.pause();
    else if (confront === 'close') store.close();
    setConfront(null);
  }

  function toggleBoredom() {
    if (boredomMode) store.stopBoredom();
    else store.startBoredom();
  }

  const canPlay = !snapshot.running && !boredomMode && (snapshot.activeTaskId != null || view.pending.length > 0);

  return (
    <div className="tw">
      <div className="tw-clock-block">
        <div className="tw-clock">{formatTime(clockValue)}</div>
        {boredomMode ? (
          <div className="tw-clock-toggle tw-boredom-label">🧱 Tanking boredom</div>
        ) : (
          <button
            type="button"
            className="tw-clock-toggle"
            onClick={store.toggleDisplayMode}
            title={displayMode === 'session' ? 'Showing this session — click for total' : 'Showing total — click for this session'}
          >
            {displayMode === 'session' ? '⏱ Session' : '∑ Total'}
          </button>
        )}
      </div>

      <div className="tw-header tw-drag">
        {boredomMode ? 'Sit still. Do nothing. Resist.' : milestone ? milestone.title : 'No milestone selected'}
      </div>

      {boredomMode ? (
        <div className="tw-tasks tw-boredom-body">
          <div className="tw-empty">
            You are timing your resistance. No phone, no switching windows — just sit in the square.
          </div>
        </div>
      ) : (
        <div className="tw-tasks">
          {view.completed.map((t) => (
            <TaskRow key={t.id} task={t} kind="completed" onClick={null} />
          ))}
          {view.active && (
            <TaskRow
              key={view.active.id}
              task={view.active}
              kind="active"
              running={snapshot.running}
              liveTotal={snapshot.baseTotalSeconds + session}
              onClick={() => store.play(view.active.id)}
            />
          )}
          {view.pending.map((t) => (
            <TaskRow key={t.id} task={t} kind="pending" onClick={() => store.play(t.id)} />
          ))}
          {view.completed.length + (view.active ? 1 : 0) + view.pending.length === 0 && (
            <div className="tw-empty">No tasks in this milestone.</div>
          )}
        </div>
      )}

      <div className="tw-controls">
        <button type="button" className="tw-btn tw-play" onClick={handlePlay} disabled={!canPlay} title="Play">
          ▶
        </button>
        <button type="button" className="tw-btn tw-pause" onClick={requestPause} disabled={!snapshot.running} title="Pause">
          ⏸
        </button>
        <button type="button" className="tw-btn tw-close" onClick={requestClose} title="Close">
          ✕
        </button>
      </div>

      <button
        type="button"
        className={`tw-boredom-btn${boredomMode ? ' tw-boredom-btn-on' : ''}`}
        onClick={toggleBoredom}
        title="Time your ability to sit still and resist the urge to escape"
      >
        {boredomMode ? '■ Stop tanking' : `🧱 ${copy(tone, 'boredom')}`}
      </button>

      {confront && (
        <div className="tw-confront">
          <div className="tw-confront-card">
            <div className="tw-confront-heading">{copy(tone, confront === 'pause' ? 'pauseHeading' : 'closeHeading')}</div>
            <div className="tw-confront-body">{copy(tone, confront === 'pause' ? 'pauseBody' : 'closeBody')}</div>
            <div className="tw-confront-actions">
              <button type="button" className="tw-btn tw-confront-stay" onClick={() => setConfront(null)}>
                {copy(tone, 'standSteady')}
              </button>
              <button type="button" className="tw-btn tw-confront-give" onClick={surrender}>
                {copy(tone, confront === 'pause' ? 'surrender' : 'surrenderClose')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, kind, running, liveTotal, onClick }) {
  const timeLabel =
    kind === 'active' && liveTotal != null ? formatTime(liveTotal) : formatTime(task.total_seconds || 0);
  return (
    <div
      className={`tw-task tw-task-${kind}${onClick ? ' tw-task-clickable' : ''}`}
      onClick={onClick || undefined}
      title={onClick ? 'Click to time this task' : undefined}
    >
      <span className="tw-task-title">{task.title}</span>
      <span className="tw-task-time">
        {kind === 'active' && running ? '● ' : ''}
        {timeLabel}
      </span>
    </div>
  );
}
