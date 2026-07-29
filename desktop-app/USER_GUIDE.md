# Task Control — User Guide

## 1. Running the app

```
cd desktop-app
npm install       # first time only
npm run dev       # starts the Vite dev server + Electron window
```

For a production-style run (no dev server, no DevTools):

```
npm run build
npm start
```

## 2. How the data is structured

```
Goal          "Launch my personal portfolio site"
 └─ Milestone "Design the homepage"     (Effort/Impact classified)
     └─ Task  "Sketch a wireframe"      (has an estimate, in minutes)
     └─ Task  "Build the homepage"
 └─ Milestone "Write the About page"
     └─ Task  ...
```

Every Milestone and Task gets a **day_offset** relative to its parent's start
date rather than a fixed date — that's what lets a future "Shift Timeline"
feature move one task's date and cascade the change to everything after it,
without you re-dating each one by hand.

## 3. Creating a Goal and Milestone (UI)

1. On the Dashboard, click **+ Goal**.
2. Fill in **Title**, and the split **Action / Artifact** fields (e.g.
   Action: "Launch", Artifact: "a personal portfolio site") — the app treats
   these two together as what "done" concretely looks like.
3. Save → you're dropped straight into **New Milestone** for that goal.
4. Fill in the milestone's Title, Action/Artifact, pick a quadrant on the
   **Effort/Impact matrix**, and set how many days after the goal's start it
   begins.
5. Save → back to the Dashboard.

## 4. Browsing by goal, and adding milestones/tasks later

Goals can have many milestones, and the Dashboard's flat "Today's Queue" (all
pending tasks across every goal) doesn't distinguish which goal any of them
belong to at a glance. The **goal tag row** above the queue fixes that:

- **All** — the flat cross-goal queue, same as before.
- **One tag per goal** — click it to switch to that goal's own view: every
  milestone under it, each with its tasks listed underneath (including
  already-completed ones, so you can see progress, not just what's left).
  This view shows a milestone even before it has any tasks — so creating a
  goal + milestone and seeing nothing in "All" no longer looks like nothing
  happened.
- **+ Goal** — same as before, starts a brand new goal.

From inside a goal's view you can now also:
- **+ Milestone** — add another milestone to that *existing* goal (previously
  only possible right after creating a brand-new goal).
- **+ Task** (per milestone) — the "New Task" screen that was missing
  entirely before now exists; fill in title, Action/Artifact, Effort/Impact,
  and an estimate in minutes.

## 5. Completing a task

Click **Complete** on any task card in Today's Queue:

1. **Proof of Completion** modal asks how many minutes it actually took
   (defaults to the estimate) and an optional note.
2. If actual time is **≤** the estimate: the task is marked complete
   immediately. Time saved goes into your **Guilt-Free Bank**.
3. If actual time is **>** the estimate: a **Time Debt justification** modal
   appears first, asking what happened. Submitting it adds the overrun
   minutes to your **Time Debt** and logs your note.

Both cases also update your daily streak and the Effort/Impact estimation
calibration — which biases future AI-suggested estimates, powers the estimate
hint on the New Task screen, and shows up as your accuracy chart in **📊 Insights**
(see §8).

## 6. Timing your work — the floating Timer widget

Each milestone in a goal's view has a **⏱ Timer** button. Click it to pop out a
small, always-on-top floating window that tracks how long you actually spend on
that milestone's tasks. It stays pinned above your other apps (even in
fullscreen), so you can keep working elsewhere while it runs.

**The window shows, top to bottom:**
- **Clock** — a big digital timer for the active task. The little toggle under it
  switches the display between **⏱ Session** (this sitting) and **∑ Total** (all
  time ever logged on that task).
- **Milestone name** — grab this bar to drag the window anywhere on screen.
- **Task list (max 5)** — a contextual window around the active task: up to 2
  **completed** tasks (gray, struck through), the **1 active** task (bold green),
  and up to 2 **pending** tasks. Click any not-yet-done task to start timing it.
- **Controls** — **▶ Play**, **⏸ Pause**, **✕ Close**.

**How the timing behaves:**
- **Only one task is ever timed at once, app-wide.** Starting a new task
  automatically pauses and saves the one that was running — no double-counting,
  no forgetting to stop the last one.
- **Your time is saved continuously** (every ~5 seconds), not just when you pause
  or close. If the app or your laptop dies unexpectedly, you lose at most a few
  seconds — the rest is already in the database, and the database file is written
  atomically so a crash can't corrupt it.
- **Sleep and clock changes don't inflate your time.** If your laptop sleeps (or
  the system clock jumps) while a task is running, the gap is *not* counted as
  work — only time you were actually awake and running the timer is credited.
- **Deleting or completing the task you're timing is safe.** If you delete the
  active task, or mark it complete from the main window, the timer notices within
  a few seconds and stops cleanly instead of running on a phantom task.
- **Pausing or closing** folds the current session's time into that task's total
  and writes it to disk immediately.

The accumulated time is stored per task in `task_control.db` (the `total_seconds`
column), so it survives restarts. Existing databases upgrade automatically the
first time you launch the updated app.

> **Note:** re-pointing the widget at a *different* milestone (clicking another
> milestone's ⏱ Timer) while a task is still running keeps timing the original
> task in the background — the clock stays correct, but the running task may not
> be visible in the newly-shown milestone's list until you pause it. Pause before
> switching milestones if you want the widget to always show what it's timing.

## 7. Unga Bunga mode — for when "encouraging" backfires

The app ships in an **encouraging** tone. For an avoidant/self-loathing stretch
where soft language just becomes another exit, switch tone to **Unga Bunga**: it
stops asking nicely and starts naming the defense mechanism.

**Turn it on** two ways:
- Click **🦣 Unga Bunga: OFF → ON** in the dashboard header, or
- Close the app and set `"tone_preference": "unga_bunga"` in `user_profile.json`.

What changes while it's on:

- **The timer confronts you.** In the floating widget, **Pause** and **Close**
  no longer act instantly — they first challenge the urge ("Your brain is making
  you feel tired right now to force you to surrender. Stand steady.") with a
  **Stand steady** vs. **Surrender anyway** choice.
- **Overruns ask which demon won, then make you pay.** When a task runs over its
  estimate, instead of a free-text excuse box you pick the **direction your mind
  went**: chasing short-term dopamine, over-complicating to avoid finishing, or a
  ray of hope making you panic and shut down. The pick is logged to
  `time_economy.ledger` — and then a **punishment menu** appears (see below).
- **The Guilt-Free Bank is locked.** Finishing under estimate no longer banks
  "free time" (which just invites slacking). The **daily streak is the only
  reward** — proof you're rewriting who you are through execution. The current
  streak shows as a 🔥 chip in the header.
- **Go Unga Bunga (single-task lockdown).** Click **Go Unga Bunga** and the whole
  dashboard vanishes: you pick **one** task and everything else — goals,
  milestones, dates, the queue — is hidden, so your brain can't add the
  overwhelming dimension of time. Finish it, or click **Stand down** to return.
- **Punishment menu (pick one — no walking away clean).** Naming any demon on an
  overrun owes a price. You're shown **four** punishments: **three** drawn at
  random from **Exercise** (push-ups, squats, a plank…), **Social** (text someone
  you've been avoiding, make a call…), **No device** (tank N minutes of boredom,
  no phone), and **Money** (move cash to savings, penalty jar…) — plus the harsh
  **🔒 Final straw** every time. You must pick exactly one; there's no cancel.
  - The non-lock punishments are **self-reported** (you serve them, they're logged
    to `time_economy.ledger`). Drawing a **No device** one opens the floating
    **Tanking Boredom** timer for its minutes so you actually sit through it.
  - **The 🔒 Final straw is the penalty lock.** Pick it and the app locks itself
    into the single-task view — this one has **no Stand down**. It releases the
    next day (the moment a new day's streak can tick); execution is the only way
    through it. (It survives relaunch and clears itself on the first launch of the
    following day.)
- **Tanking Boredom.** The floating widget gains a **🧱 Tanking Boredom** button.
  When you're too paralyzed to work, click it and it times how long you can sit in
  your 6×6 square doing *nothing* — no phone, no window-switching — turning "sit
  still and resist the urge to escape" into a tracked action. Each session is
  saved to the ledger as a `boredom_tank` entry.

> Unga Bunga is a *tone*, not a separate account — flip it off any time (header
> toggle or the JSON) and every default behavior returns. The **penalty lock** is
> the one thing you can't click away; it waits for tomorrow.

## 8. Insights, smart queue, reminders & backup

The app quietly records a lot — completions, time, estimate accuracy, a ledger —
and this is where you actually *see* it and act on it.

**📊 Insights (dashboard header).** Click **📊 Insights** to open the stats screen:

- **Top line** — tasks completed, tasks still open, total time tracked, and your
  current/best streak.
- **Time economy** — your **Time Debt** and **Guilt-Free Bank** totals, each with
  a control to draw it back down: **Repay** debt or **Spend** bank minutes (both
  clamp to what you actually have). In **Unga Bunga** tone the Bank stays locked,
  so its spend control is hidden — the streak is the reward (see §7).
- **Estimate accuracy** — for each Effort/Impact quadrant, how your actual times
  compare to your estimates (e.g. "High effort / High impact runs 1.4× your
  estimate"). `1.00×` is dead-on; over 1 means you underestimate that quadrant.
- **Reliability & capacity** — how your work actually lands against its own dates:
  the share you **finish on time** vs. **late**, how many open tasks have **slipped**
  (their scheduled date already passed), and the same on-time breakdown per
  quadrant. Alongside it, your **learned daily capacity** — the realistic amount of
  work you clear on an active day (recency-weighted, so it adapts) — and a **14-day
  load strip** showing planned minutes per upcoming day against that capacity, with
  over-packed days flagged. This is derived from data you already generate; nothing
  new to fill in.
- **Consistency** — a GitHub-style heatmap of your completions over recent weeks.
- **Recent activity** — a readable feed of the `time_economy.ledger` (debt, bank,
  boredom-tanks, punishments).

**Calibration hint when creating tasks.** On **New Task**, once you pick an
Effort/Impact quadrant the estimate field shows a hint based on your own history
("tasks like this run ~1.4× — consider 42 min") with a one-click apply. It's only
a suggestion; it never overwrites your number on its own.

**Overload warning when scheduling.** Also on **New Task**, if the day you pick is
already fuller than your learned capacity (counting this task's *realistic* cost —
your estimate scaled by that quadrant's history), a warning appears with a
one-click **"day N"** button that jumps to the soonest lighter day. Advisory only;
it never moves anything on its own.

**Smart priority queue.** "Today's Queue" is no longer sorted by date alone — it's
scored by **leverage** (Impact weighed against Effort) plus **due-date urgency**,
so quick, high-impact, and overdue work floats to the top. Each card shows a
quadrant label (**Quick Win / Big Bet / Filler / Trap**), an **⚠ Overdue** chip
when it's past its date, and a **Slip-prone** chip on task *types* you chronically
let slide — those also get nudged a little higher so they stop rotting. Above the
list, an **"On your plate now"** meter sums everything due today or overdue (in
realistic minutes) against your learned daily capacity. Use the **Priority ↔ Date**
toggle to switch back to plain chronological order any time.

**Reminders & the system tray.** Turn on **"Notify me about tasks due today or
overdue"** in Insights (on by default) and the app raises an OS notification for
due/overdue tasks — at most once per task per day; clicking it brings the app
forward. So these can fire even after you close the window, the app now lives in a
**system tray**:

> **Behavior change:** closing the main window no longer quits the app — it keeps
> running in the tray so reminders still fire. **Right-click the tray icon → Quit**
> to fully exit. (Turn reminders off in Insights if you'd rather not be nudged.)

**Backup & restore.** In Insights, under **Reminders & data**:

- **Export backup…** — pick a folder; the app copies your `task_control.db` and
  `user_profile.json` into a timestamped backup there.
- **Restore backup…** — pick a previously-exported folder; after a confirmation it
  backs up your current files, swaps in the backup, and **restarts** the app.

## 9. Where your data lives, and how to change it

Two files, both under:

- **Windows:** `%APPDATA%\task-control-desktop\`
- **macOS:** `~/Library/Application Support/task-control-desktop/`
- **Linux:** `~/.config/task-control-desktop/`

| File | What it is |
|---|---|
| `task_control.db` | SQLite database (Goals/Milestones/Tasks) — standard SQLite format, openable with any SQLite browser (e.g. "DB Browser for SQLite") if you want to inspect or hand-edit rows. |
| `user_profile.json` | Your Personalization Engine state. |

**To change your personalization settings** (tone, work hours, peak energy,
risk tolerance): close the app, open `user_profile.json`, edit the
`personalization` block, save, relaunch.

```json
"personalization": {
  "tone_preference": "encouraging",
  "work_hours": { "start": "08:00", "end": "17:00" },
  "peak_energy_windows": ["morning"],
  "risk_tolerance": "medium",
  "notifications_enabled": true
}
```

`tone_preference` accepts `"encouraging"` (default) or `"unga_bunga"` (see §7).
`notifications_enabled` toggles the due/overdue reminders (see §8) — you can flip
it here or from the Insights screen.

Don't hand-edit `time_economy`, `estimation_calibration`, `streaks`, or
`focus_lock` — those are a running history/state computed from real task
completions and mode toggles; editing them just desyncs the numbers (or leaves
you stuck in, or wrongly out of, the single-task lock) from what actually
happened.

**To reset everything and start fresh:** close the app and delete the whole
`task-control-desktop` folder above. It gets recreated with defaults the
next time you launch.

## 10. Example goal, for testing the whole system

A seed script populates one realistic Goal so you can test the full loop
without hand-building data first:

```
npm run seed
```

This creates, in your real data files:

- **Goal:** "Launch my personal portfolio site"
  - **Milestone:** "Design the homepage" (Low Effort / High Impact)
    - Task: "Sketch a wireframe" — est. 30 min
    - Task: "Pick a color palette" — est. 20 min
    - Task: "Build the homepage in code" — est. 90 min (High Effort / High Impact)
  - **Milestone:** "Write the About page content" (starts day 3)
    - Task: "Draft your bio" — est. 45 min
    - Task: "Get a friend's feedback" — est. 15 min

It's safe to re-run — it detects the goal already exists and skips instead
of duplicating.

**Suggested test pass**, once you `npm run dev` with the seed data in place:

1. Complete **"Sketch a wireframe"** with 30 min → matches the estimate
   exactly, no Time Debt or Bank change, streak ticks up by one.
2. Complete **"Pick a color palette"** with 10 min → 10 min under estimate,
   added to your **Guilt-Free Bank**.
3. Complete **"Build the homepage in code"** with 120 min → 30 min over
   estimate, triggers the **Time Debt justification** modal; whatever you
   type there gets saved to the ledger.
4. Reopen `user_profile.json` afterward and check `time_economy.ledger` —
   you should see both entries from steps 2 and 3, plus the updated running
   totals.

## 11. AI planning (Ollama) — wired on the backend, not yet in the UI

`electron/services/AI_Service.js` and the `ai:generateMilestonePlan` IPC
channel can turn a "Big Vague Goal" into a full Milestone/Task breakdown,
personalized from your profile — but no screen calls it yet. To use it
today you'd invoke `window.api.ai.generateMilestonePlan("your goal text")`
from the DevTools console while the app is running.

Requirements:
```
ollama serve
ollama pull llama3
```

Wiring this to a "Generate with AI" button on the New Goal screen is a
reasonable next step if you want it.

## 12. Troubleshooting

- **`Electron failed to install correctly`** — the Electron binary download
  during `npm install` can land corrupted on restrictive networks. Delete
  `node_modules/electron/dist` and reinstall; if it still doesn't extract
  the actual `electron.exe`, that's a sign the zip download itself needs
  retrying by hand.
- **App runs but no window ever opens, or it exits immediately printing
  Node output** — something in your shell has `ELECTRON_RUN_AS_NODE` set,
  which makes any Electron binary run as plain Node. Always start the app
  via `npm run dev` / `npm start` (they route through
  `electron/launch.js`, which strips that variable before launching) rather
  than running `electron .` directly.
- **`npm install` fails trying to compile a native module** — this project
  deliberately uses `sql.js` (WASM SQLite) instead of a native SQLite
  binding for exactly this reason. If a future dependency needs native
  compilation, prefer a pure-JS/WASM alternative before reaching for
  Visual Studio Build Tools.