# Task Control

A local-first desktop productivity app that structures work as **Goals →
Milestones → Tasks**, holds you accountable to your own time estimates, and gets
out of the way. It pairs an Effort/Impact triage model with a time-economy
(Time Debt / Guilt-Free Bank), optional AI milestone planning, a live-web
step-by-step guide, and an always-on-top floating timer — plus an opt-in
**"Unga Bunga"** anti-avoidance mode for the days when soft encouragement just
becomes another exit.

Everything runs on your machine. Your task data lives in a local SQLite file and
a JSON profile in your OS app-data directory — nothing is sent to a server
except the optional AI/web-guide calls you explicitly trigger.

---

## Features

- **Goals → Milestones → Tasks** with an **Effort/Impact** matrix so you triage
  by leverage, not just urgency.
- **Time economy** — every task carries a minute estimate. Finish under it and
  time flows into a **Guilt-Free Bank**; run over and it books to **Time Debt**
  with a logged reason, feeding an estimation-calibration model that sharpens
  future estimates.
- **Floating timer widget** — a frameless, always-on-top window that times one
  task at a time (single-active, app-wide), survives crashes/sleep without
  inflating your logged time, and persists continuously.
- **Insights dashboard** — a 📊 stats screen that finally surfaces what the app
  records: completions, time tracked, per-quadrant **estimate accuracy**, a
  streak heatmap, and a readable ledger — plus controls to **repay Time Debt** /
  **spend the Bank**.
- **Smart priority queue** — the queue is scored by Effort/Impact **leverage**
  and due-date urgency (not just date), flags **overdue** tasks, labels each
  quadrant (Quick Win / Big Bet / Filler / Trap), and offers a Priority↔Date
  sort toggle.
- **Adaptive behavior model** — learns, from data you already generate, your
  **on-time vs. late** reliability, which task types you chronically **slip**, and
  your realistic **daily capacity**. It puts that to work: a reliability/capacity
  readout and 14-day load strip in Insights, an **overload warning** (with a
  one-click lighter day) when scheduling, an "on your plate" load meter, and a
  gentle priority nudge for slip-prone work. Lightweight running statistics — no
  ML dependency.
- **Reminders & data safety** — optional OS notifications for tasks due today or
  overdue (with a **system tray** so they fire even when the window is closed),
  and one-click **backup / restore** of your database + profile.
- **AI milestone planning** *(optional)* — turn a "big vague goal" into a
  structured Milestone/Task breakdown via a local **Ollama** model.
- **Almighty Guide** *(optional)* — a live-web, step-by-step how-to for any task,
  built from a **Tavily** search pipeline.
- **Prep phase & Follow-ups** — a sympathetic assistant that helps you *start* and
  *finish*. **Prepare** a task (tools/materials, a get-ready checklist, a "what
  you've done" note — with optional **AI-suggested** prep from the local model),
  and let the app track the **loose ends** it leaves behind: submit-by-a-deadline
  and email-someone-then-wait-for-a-reply **follow-ups** that nudge you (even while
  you work other tasks), **defer during a focus lock**, and repeat until you answer
  them in the in-app inbox. See [desktop-app/USER_GUIDE.md](desktop-app/USER_GUIDE.md) §9.
- **Quick Notes & Chores** — a low-friction note pad you can open anytime. Capture
  **structured notes** (Classification `\label` / Header / Sub-header / Content) that
  **auto-merge** — re-saving the same Classification+Header+Sub-header **appends** to
  the existing note instead of duplicating, and the list groups them by
  classification as expandable Header · Sub-header rows (Enter saves, Shift+Enter for
  a newline). Or use the quick **`/`** line — **`/plan`** routes into Quick Capture,
  **`/chore`** a one-off reminder, **`/daily`** a repeating daily chore — with a
  **batch "process"** step (and **Select all**) to clear the inbox in one action.
  Daily chores reset each day, take an optional time, and (like everything) stay
  silent during a focus lock. See [desktop-app/USER_GUIDE.md](desktop-app/USER_GUIDE.md) §10.
- **Lock In mode** *(opt-in tone, formerly "Unga Bunga")* — inverts the soft
  defaults for an avoidant stretch: confrontational timer prompts, a
  defense-mechanism picker instead of a free-text excuse box, a streak-only reward
  (the Bank locks), a post-overrun **punishment menu**, a **single-task lockdown**
  that hides everything else, and a **"Tanking Boredom"** resistance timer. See
  [desktop-app/USER_GUIDE.md](desktop-app/USER_GUIDE.md) §7.
- **Leisure Loan** — borrow play time now and repay it as a **forced focus lock at
  1.25× interest** right after. A strict commitment device that completes the
  time-economy (leisure *earned* / focus *owed* / leisure *borrowed*): unlocked by
  a 3-day streak, capped once per day (twice when consistent), and impossible to
  dodge by quitting the app. See
  [desktop-app/USER_GUIDE.md](desktop-app/USER_GUIDE.md) §8.

---

## Repository layout

This repo contains **two** codebases:

| Path | What it is | Status |
|---|---|---|
| [`desktop-app/`](desktop-app/) | **Electron + React (Vite) desktop app** | **Active — build/run this** |
| repo root (`App.js`, `screens/`, `services/`, `db/`, `profile/`) | Original React Native / Expo port | Legacy reference only |

All active development happens in `desktop-app/`. The root Expo port is kept for
reference and is not the build target.

---

## Quick start (desktop app)

```bash
cd desktop-app
npm install        # first time only
npm run dev        # Vite dev server (:5173) + Electron, live-reload
```

Production-style run (no dev server / DevTools):

```bash
npm run build      # bundles the renderer -> desktop-app/dist
npm start          # launches Electron against the built renderer
```

Populate one realistic example Goal to explore the full loop:

```bash
npm run seed
```

See [requirements.txt](requirements.txt) for the full prerequisite list.

---

## Architecture (desktop-app)

- **Process split** — the **main process** (`electron/`) owns the database, all
  services, IPC handlers, and window creation (single source of truth across
  windows). **Renderers** (`src/`) are React and talk to main *only* through the
  `window.api` bridge in `preload.js` — `contextIsolation` is **on** and
  `nodeIntegration` is **off**.
- **Two windows** via a Vite multipage build: `index.html` (main app) and
  `widget.html` (floating timer).
- **Persistence** — `sql.js` (WASM SQLite, in-memory) with debounced, **atomic**
  writes (`*.tmp` + rename) so an abrupt kill can't corrupt the database.
- **Services** — `AI_Service` + `ollamaClient` (planning), `guideService` +
  `tavilyClient` (web guides), `timerService` (authoritative timer state).

See [CLAUDE.md](CLAUDE.md) for the in-depth architecture and conventions.
