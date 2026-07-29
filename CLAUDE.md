# CLAUDE.md — Task Control APP

Guidance for Claude Code (and any agent) working in this repo.

## What this repo is

A personal productivity app that organizes work as **Goals → Milestones → Tasks**,
with Effort/Impact classification, time-estimate tracking (Guilt-Free Bank / Time
Debt), a Personalization Engine, AI milestone planning (Ollama), and an
always-on-top floating timer widget.

There are **two codebases** in this repo:

| Path | What it is | Status |
|---|---|---|
| **`desktop-app/`** | Electron + React (Vite) desktop app | **Active — do work here** |
| repo root (`App.js`, `screens/`, `services/`, `db/`, Expo `package.json`) | Original React Native / Expo port | Legacy reference; not the active target |

Unless a task explicitly concerns the React Native port, **all development happens
in `desktop-app/`.**

## Running it (desktop-app)

```
cd desktop-app
npm install        # first time only
npm run dev        # Vite dev server (:5173) + Electron, via concurrently
npm run build      # production renderer build -> desktop-app/dist
npm start          # run Electron against the built renderer
npm run seed       # populate one realistic example Goal
```

Do **not** kill/restart the running Electron / `npm run dev` / Ollama processes
without explicit user consent. Picking up changes to main-process code
(`electron/**`) or `preload.js` requires an app restart the user must approve.

## Architecture (desktop-app)

**Process split (Electron):**
- **Main process** (`electron/`) — owns the DB, all services, IPC handlers, and
  window creation. Single source of truth shared across windows.
- **Renderer(s)** (`src/`) — React. Two HTML entry points via a Vite multipage
  build (`vite.config.js` `rollupOptions.input`): `index.html` (main app) and
  `widget.html` (floating timer). Renderers talk to main only through the
  `window.api` bridge exposed by `preload.js` (contextIsolation on, nodeIntegration
  off).

**Data / persistence:**
- `sql.js` (WASM SQLite, **in-memory**). Writes are manually persisted to disk
  via `persist()` in `electron/db/database.js`. `db.export()` is O(whole DB) and
  blocks the main thread, so `persist()` is **debounced** (trailing 1.5s) and the
  in-memory DB stays the source of truth for reads in between. `persist({ immediate:
  true })` forces a synchronous flush at durability points — `app` `before-quit`,
  timer pause, and widget close. The write itself is **atomic** (`*.tmp` +
  `renameSync`) so an abrupt kill can never leave a truncated `task_control.db`.
- Schema for fresh DBs: `electron/db/schemaSql.js`. Column additions to existing
  DBs go through `runMigrations()` → `ensureColumn(...)` in `database.js`. **Add
  new columns in both places.**
- Data files live under the OS app-data dir (`%APPDATA%\task-control-desktop\` on
  Windows): `task_control.db` + `user_profile.json`.

**Services** (`electron/services/`):
- `AI_Service.js` + `ollamaClient.js` — AI milestone planning (Ollama, `llama3`).
- `guideService.js` + `tavilyClient.js` — step-by-step web guides (Tavily search).
- `timerService.js` — authoritative timer state (see below).

## The Timer widget (feature)

A floating, always-on-top window that times one active task at a time.

**Why the split:** the spec asked for a "Zustand store" for timer logic, but the
widget is a **separate window**, so a renderer store cannot enforce "only one
active task across the whole app." Authority therefore lives in the **main
process**; the renderer gets a Zustand-equivalent mirror.

- **`electron/services/timerService.js`** — the authority. Enforces single-active
  (`play(taskId)` commits + stops any running task before starting the new one),
  computes session/total time, and does **crash-safe persistence**: a 5s flush
  folds elapsed whole-seconds into `tasks.total_seconds`, computing a delta from
  `flushedThisSession` so the periodic flush and the final pause/close flush never
  double-count (abrupt close loses ≤5s). Broadcasts snapshots to all windows.
  Two correctness guards live here:
  - **Sleep / clock-jump clamp** (`creditElapsed`) — session time is wall-clock
    (`Date.now()`), so a laptop sleep or NTP/DST/manual clock change would
    otherwise dump the whole gap into `total_seconds` as "worked" time. Each
    credit is capped to the real seconds elapsed since the last credit (+1s
    slack); a larger jump is treated as a gap and dropped. `lastSessionSeconds`
    reports credited (post-clamp) seconds, not raw wall time.
  - **Self-heal on deleted/completed active task** (`flushToDb`) — `activeTaskId`
    is module state with no FK to the DB, so deleting or completing the timed
    task from another window would leave a phantom running clock (0-row UPDATEs,
    or time piling onto a done task). The flush re-reads the row and, if it's
    gone or `completed`, stops the clock cleanly (dropping a deleted task's id).
  - **Boredom mode** (`startBoredom`/`stopBoredom`) — `state.mode` is
    `'idle' | 'task' | 'boredom'`. "Tanking Boredom" times *resistance* (no task);
    it's single-active with the task clock (starting a task or closing the widget
    ends it via `endBoredom`). Boredom seconds accumulate through the same 5s loop
    with the same sleep clamp (`creditBoredom`). The service is profile-agnostic,
    so a finished session is handed to main.js via the injected `onBoredomEnd`
    callback, which logs it to the ledger (`profileEngine.logBoredom`).
- **`src/widget/timerStore.js`** — dependency-free Zustand-equivalent
  (`createStore` → `getState`/`setState`/`subscribe` + `useTimerStore` via
  `useSyncExternalStore`). Mirrors broadcast snapshots; holds widget-only state
  (display toggle, 1s tick). Does **not** own timer truth.
- **`src/widget/TimerWidget.jsx`** — the UI: toggleable Session/Total clock,
  milestone header (draggable region), contextual max-5 task list (≤2 completed
  gray-strikethrough / 1 active bold-green / ≤2 pending), Play/Pause/Close.
  `buildTaskView` excludes the active task from **both** the completed and
  pending slices, so a task completed while still active renders once (as the
  active row), never simultaneously as a gray-struck completed row.
- **Always-on-top** — `electron/main.js` `createWidgetWindow()`: frameless
  `BrowserWindow` with `alwaysOnTop: true` + `setAlwaysOnTop(true, 'floating')` +
  `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`. Window drag via
  CSS `-webkit-app-region: drag`.
- **Trigger** — the **⏱ Timer** button per milestone in `GoalMilestonesView.jsx`
  (`window.api.timer.openWidget(milestone.id)`).
- **DB** — `tasks.total_seconds INTEGER NOT NULL DEFAULT 0` (schema + migration).

## Unga Bunga mode (feature)

An opt-in anti-avoidance profile that inverts the app's soft defaults. Gated on
`personalization.tone_preference === 'unga_bunga'` (vs. the default
`'encouraging'`). Toggle from the dashboard **or** by hand-editing
`user_profile.json`. Default behavior is unchanged when the tone is anything else.

- **Tone copy** lives in one place, `src/lib/tone.js` (`isUngaBunga`, `copy(tone,
  key)`, `DEFENSE_MECHANISMS`) — so the main window and the floating widget never
  drift. The widget mirrors tone changes live via a `profile:tone` broadcast
  (`profile.onToneChange`); `timerStore` holds the `tone` and re-reads it.
- **Confrontation** — in the widget, Pause/Close first show a confrontation
  overlay ("Your brain is making you feel tired… Stand steady.") instead of
  obeying immediately (`TimerWidget.jsx`, `confront` state).
- **Time Debt modal** — `TimeDebtJustificationModal.jsx` swaps the free-text box
  for a required "Direction of Mind" defense-mechanism pick. The completion
  `justification` becomes structured `{ defense_mechanism, note }`;
  `profileEngine.parseJustification` still accepts the old plain-string form.
- **Reward inversion** (`recordTaskCompletion`) — in this tone an under-run does
  **not** credit `guilt_free_bank_minutes` (logged as `bank_locked`); the streak
  is the only reward.
- **Punishment menu** — an overrun that names any defense mechanism makes
  `recordTaskCompletion` return `penaltyPending: true` (it no longer locks
  directly). The renderer (`useTaskCompletion` → `PunishmentModal.jsx`, options
  from `src/lib/punishments.js` `rollPunishments()`) shows **3 random draws**
  (one each from 3 of 4 categories: exercise / social / no_device / money) **+**
  the guaranteed harsh **`lock`** final straw; the user must pick one. The choice
  is served via `profile.servePunishment` → `profileEngine.servePunishment`,
  which logs a `punishment` ledger entry and, for `category === 'lock'` **only**,
  arms the `penalty` focus lock. A `no_device` pick also opens the boredom timer
  (`timer.openWidget(null)` + `startBoredom`). Because serving a `lock` arms the
  focus lock that the shell reacts to, the hook **defers** its `onCompleted`
  refresh until after the punishment is served.
- **Single-task lock** — `profile.focus_lock` is a **computed** block (don't
  hand-edit): `{ active, task_id, reason: 'manual' | 'penalty', locked_on }`. When
  active, `App.jsx` replaces the whole UI with `FocusLockScreen.jsx` (the Guide is
  the one allowed escape). `reason:'manual'` (Go Unga Bunga toggle) exits via
  "Stand down"; `reason:'penalty'` (dopamine overrun) has no exit and auto-clears
  the next day — `profileEngine.normalizeProfile()` clears a penalty lock whose
  `locked_on < today()` on every load, so no background timer is needed.
  `normalizeProfile` also backfills `focus_lock` into older profiles.

## Insights, Smart Queue, Economy Loop, Reminders (upgrade)

Four features that surface data the app already recorded but never showed, and
close loops that were left open. All zero-new-dependency (SVG/CSS charts,
Electron built-ins).

- **Insights screen** (`src/screens/InsightsScreen.jsx`, reached via the **📊
  Insights** button in the dashboard header; routed in `App.jsx` as
  `screen.name === 'insights'`). Reads `profile.load()` (ledger / calibration /
  streaks / time-economy — already fully returned) plus a new DB aggregate
  `stats:overview` (`db.getCompletionStats()`): completed/open counts, tracked
  seconds, and per-day completions for the streak heatmap. Charts are hand-rolled
  in `src/components/charts/Charts.jsx` (`BarRow`, `Heatmap`) — **no chart lib**.
- **Smart priority queue** — `db.getActiveTaskQueue()` now decorates each row with
  a JS-computed `priority` (impact×2 − effort + due-date urgency), an `overdue`
  flag, and a `quadrant` label, sorted by priority (stable sort keeps the old
  chronological order as tiebreaker). The dashboard `AllTasksView` renders the
  ⚠ Overdue / quadrant chips and a Priority↔Date sort toggle.
- **Closed economy loop** — the previously dead `profileEngine.repayTimeDebt` /
  `spendGuiltFreeBank` are now wired via `profile:repayTimeDebt` / `profile:spendBank`
  (→ `window.api.profile.repayDebt/spendBank`) and driven from the Insights
  economy cards (the Bank spend control is hidden in Unga Bunga tone). Manual task
  creation shows a calibration-based estimate hint via `src/lib/calibration.js`
  `suggestEstimate()`.
- **Reminders & data safety** — `electron/services/reminderService.js` fires an OS
  `Notification` for tasks due today/overdue (`db.getDueTasks`), once per task per
  day, gated on `personalization.notifications_enabled` (default true, backfilled
  in `normalizeProfile`; toggled via `profile:setNotifications`). A `Tray` in
  `main.js` keeps the app alive after the window closes so reminders keep firing —
  **`window-all-closed` no longer quits on Windows**; quit from the tray menu
  (sets `app.isQuitting`). Backup/restore via `data:export` / `data:import`
  (built-in `dialog` + `fs` copy of `task_control.db` + `user_profile.json`;
  import backs up the current pair then `app.relaunch()`s). Tray icon:
  `desktop-app/build/tray.png`.

## Adaptive behavior model (upgrade)

A learning layer that reads back signals the app already records but never
surfaced — **how work lands against its own dates** and **how much the user
realistically clears per day** — and uses them advisorily (never silently) across
Insights, New Task, and the dashboard queue. Same **zero-dependency** rule:
lightweight recency-weighted / windowed statistics (the `estimation_calibration`
family), pure-JS model + SVG. **No SQLite schema change** — everything derives
from existing columns.

- **DB aggregates** (`electron/db/database.js`, reads only):
  - `getReliabilityStats(weeks)` — classifies completed tasks **on-time vs late**
    (`date(completed_at)` vs `scheduled_date`) and counts open **slipped** tasks
    (`scheduled_date < today`), overall and **per quadrant** (`quadrantLabel`).
  - `getScheduleLoad(fromDate, days)` — per upcoming day, open-task count +
    `SUM(estimated_minutes)`.
  - `getCompletionStats().by_day` now also carries `minutes` (`SUM(actual_minutes)`)
    for the capacity model.
  - `computePriority(task, todayStr, slipMap)` takes an optional per-quadrant
    slip-rate map; a chronically-slipped quadrant (>50%, ≥3 samples) gets a **+1**
    nudge. `getActiveTaskQueue()` builds the map via `getQuadrantSlipMap()` and
    tags each row `slip_risk`.
  - **Tasks carry `scheduled_date` only** — `due_date` lives on `milestones`, not
    `tasks`. Any task-level deadline query must key off `scheduled_date` (an
    earlier `due_date` reference in `getDueTasks` was a latent crash, now fixed).
- **Pure model** (`src/lib/behaviorModel.js`, unit-tested): `learnedCapacity`
  (recency-weighted minutes+tasks per active day), `realisticMinutes` (estimate ×
  calibration ratio — ties the two learning systems), `dayLoadStatus`
  (`light|balanced|overloaded`, overloaded >1.25× capacity), `reliabilityRates`,
  `soonestOpenDay` (first upcoming day under capacity → the "lighter day"
  suggestion), `forecastDays`, plus `addDaysStr`/`daysBetween`/`loadForDay` helpers.
- **IPC**: `stats:reliability` / `stats:scheduleLoad` (→ `window.api.stats.*`);
  capacity/forecast are derived in the renderer from `stats.overview().by_day`.
- **Surfacing**: Insights **"Reliability & capacity"** section (on-time/late/slipped
  bars, per-quadrant rows, capacity card, `LoadStrip` in `Charts.jsx`, forecast
  line); New Task **overload warning** + one-click lighter day; dashboard
  **"On your plate now"** meter + **Slip-prone** chip. Tone-agnostic (the confirmed
  choice was "same as encouraging"), so no `tone.js` change.

## Conventions

- Renderer never accesses Node/DB directly — always go through `window.api.*`
  (defined in `preload.js`, handled in `main.js` `registerIpcHandlers()`).
- Match the existing minimal dependency set (react, react-dom, sql.js, electron,
  vite). Prefer zero-dependency solutions over adding packages; prefer pure-JS/WASM
  over native modules (that's why `sql.js`, not a native SQLite binding).
- Validate main-process changes with `node --check` and the full app with
  `npm run build` before declaring done.

## Security

- Never ask the user to paste the Tavily API key/secret into chat (it gets logged).
  It's provided via the `TAVILY_API_KEY` env var or the in-app KeyPrompt, and the
  raw key must never be sent to the renderer.
