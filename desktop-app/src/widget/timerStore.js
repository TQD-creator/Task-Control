// A tiny Zustand-equivalent store for the timer widget.
//
// The AUTHORITATIVE timer state (which task is active, session/total time,
// single-active enforcement, DB persistence) lives in the main-process
// timerService — see electron/services/timerService.js. It has to, because the
// widget is a separate window and only the main process is shared across
// windows. This store is the renderer's local mirror: it holds the last
// broadcast snapshot plus the widget-only concerns (which milestone's tasks to
// show, the session/total display toggle, and a 1-second tick that re-renders
// the live clock).
//
// The API (create -> { getState, setState, subscribe } + a useSyncExternalStore
// hook) mirrors Zustand so it's a drop-in equivalent with zero dependencies.

import { useSyncExternalStore } from 'react';

function createStore(initializer) {
  let state;
  const listeners = new Set();

  const getState = () => state;
  const setState = (partial) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  };
  const subscribe = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };

  state = initializer(setState, getState);
  return { getState, setState, subscribe };
}

async function loadContext(setState, milestoneId) {
  if (milestoneId == null) {
    setState({ milestone: null, tasks: [] });
    return;
  }
  const [milestone, tasks] = await Promise.all([
    window.api.milestones.get(milestoneId),
    window.api.tasks.listByMilestone(milestoneId),
  ]);
  setState({ milestone, tasks });
}

export const timerStore = createStore((setState, getState) => ({
  // Last snapshot broadcast by the main-process authority.
  snapshot: {
    milestoneId: null,
    activeTaskId: null,
    mode: 'idle', // 'idle' | 'task' | 'boredom'
    running: false,
    startedAt: null,
    boredomStartedAt: null,
    baseTotalSeconds: 0,
    lastSessionSeconds: 0,
  },
  milestone: null,
  tasks: [],
  tone: 'encouraging', // drives the confrontational copy on pause/close
  displayMode: 'session', // 'session' | 'total'
  tick: 0, // bumped every second to force the live clock to re-render

  toggleDisplayMode: () =>
    setState((s) => ({ displayMode: s.displayMode === 'session' ? 'total' : 'session' })),

  // Remote-control the authority. play() there enforces the single-active rule
  // and broadcasts back to us, so we don't optimistically mutate here.
  play: (taskId) => window.api.timer.play(taskId),
  pause: () => window.api.timer.pause(),
  close: () => window.api.timer.close(),
  startBoredom: () => window.api.timer.startBoredom(),
  stopBoredom: () => window.api.timer.stopBoredom(),

  // Apply an incoming authoritative snapshot. Reloads the milestone/task
  // context when the milestone changes, and refreshes task rows on every
  // snapshot so the flushed total_seconds stays current.
  applySnapshot: async (snapshot) => {
    const prev = getState().snapshot;
    setState({ snapshot });
    if (snapshot.milestoneId !== prev.milestoneId) {
      await loadContext(setState, snapshot.milestoneId);
    } else if (snapshot.milestoneId != null) {
      const tasks = await window.api.tasks.listByMilestone(snapshot.milestoneId);
      setState({ tasks });
    }
  },
}));

// Wires the store to the main process exactly once (guarded so React
// StrictMode's double-mount in dev doesn't double-subscribe). Kicks off the
// authoritative-state subscription, an initial state pull, and the 1s ticker.
let initialized = false;
export function initTimerStore() {
  if (initialized) return;
  initialized = true;

  const { setState, getState } = timerStore;

  window.api.timer.onState((snapshot) => getState().applySnapshot(snapshot));
  window.api.timer.getState().then((snapshot) => getState().applySnapshot(snapshot));

  // Tone drives the widget's confrontational pause/close copy. Pull it once and
  // keep it live — the main window can toggle Unga Bunga while the widget is open.
  window.api.profile.load().then((p) => setState({ tone: p?.personalization?.tone_preference ?? 'encouraging' }));
  window.api.profile.onToneChange((tone) => setState({ tone: tone ?? 'encouraging' }));

  setInterval(() => {
    // Re-render while either clock is live — a running task or a boredom session.
    const snap = getState().snapshot;
    if (snap.running || snap.mode === 'boredom') setState((s) => ({ tick: s.tick + 1 }));
  }, 1000);
}

// Hook: subscribe a component to the whole store (selector optional). The state
// object is a stable reference between changes, so returning it wholesale is
// safe for useSyncExternalStore.
export function useTimerStore(selector = (s) => s) {
  return useSyncExternalStore(timerStore.subscribe, () => selector(timerStore.getState()));
}
