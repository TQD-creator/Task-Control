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
- **AI milestone planning** *(optional)* — turn a "big vague goal" into a
  structured Milestone/Task breakdown via a local **Ollama** model.
- **Almighty Guide** *(optional)* — a live-web, step-by-step how-to for any task,
  built from a **Tavily** search pipeline.
- **Unga Bunga mode** *(opt-in tone)* — inverts the soft defaults for an
  avoidant stretch: confrontational timer prompts, a defense-mechanism picker
  instead of a free-text excuse box, a streak-only reward (the Bank locks), a
  post-overrun **punishment menu**, a **single-task lockdown** that hides
  everything else, and a **"Tanking Boredom"** resistance timer. See
  [desktop-app/USER_GUIDE.md](desktop-app/USER_GUIDE.md) §7.

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

---

## Where your data lives

The app writes to the OS app-data directory — **not** into this repo:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\task-control-desktop\` |
| macOS | `~/Library/Application Support/task-control-desktop/` |
| Linux | `~/.config/task-control-desktop/` |

Files there: `task_control.db` (tasks), `user_profile.json` (personalization
state), and `settings.json` (the Tavily key, if you set one in-app).

---

## Security & privacy

- **Local-first.** Task data never leaves your machine. The only outbound calls
  are the **Ollama** (localhost) planning and the **Tavily** web-guide search —
  both optional and user-triggered.
- **Secrets stay out of the repo.** The Tavily API key is read from the
  `TAVILY_API_KEY` environment variable or entered in-app and stored only in the
  OS app-data `settings.json`. It is **never** committed and **never** exposed to
  the renderer — the UI can only ask *whether* a key is set. Don't paste API keys
  into issues, commits, or chat.
- **`.gitignore`** excludes `node_modules/`, build output, logs, environment
  files, and any runtime data/DB/profile files.

---

## License

No license file is included yet — add one before making the repository public if
you intend to allow reuse.
