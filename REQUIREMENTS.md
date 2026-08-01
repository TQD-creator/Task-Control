# Requirements → Functions → Achievements

A traceability matrix for **Task Control** (desktop-app). Each row maps a stated
requirement to the concrete functions/modules that deliver it and its verification
status. Status legend: ✅ done & tested · ⚠️ done, gap noted · ⛔ not started.

Last evaluated: 2026-08-01. Automated verification at time of writing:
**165/165 unit assertions pass**, production build clean (both `index.html` +
`widget.html` transform), headless boot smoke clean (fresh init + idempotent
migrations + persistence).

---

## 1. Core: Goals → Milestones → Tasks

| Requirement | Delivered functions / modules | Status |
|---|---|---|
| Organize work as Goals → Milestones → Tasks | `createGoal`/`createMilestone`/`createTask` + `getGoalById`/`getActiveTaskQueue` (`electron/db/database.js`); `DashboardScreen.jsx`, `GoalMilestonesView.jsx`, `NewGoal/NewMilestone/NewTaskScreen.jsx` | ✅ |
| Effort/Impact triage matrix | `Badge`, `EFFORT_IMPACT_COLORS`, `quadrantLabel`, `computePriority` | ✅ |
| Time estimate per task, tracked vs actual | `tasks.estimated_minutes`/`actual_minutes`; `recordTaskCompletion` (`profileEngine.js`) | ✅ |
| Quick Capture — one paragraph → full tree via AI | `CaptureScreen.jsx` → `AI_Service.analyze` → `CaptureReviewScreen.jsx` | ✅ |

## 2. Time economy

| Requirement | Delivered functions / modules | Status |
|---|---|---|
| Under-run credits a Guilt-Free Bank | `recordTaskCompletion` → `guilt_free_bank_minutes`; `spendGuiltFreeBank` | ✅ |
| Over-run books Time Debt with a logged reason | `recordTaskCompletion` + `parseJustification`; `repayTimeDebt` | ✅ |
| Estimates self-sharpen from history | `estimation_calibration` family; `src/lib/calibration.js` `suggestEstimate` | ✅ |
| Economy loop is closable from the UI | `profile:repayTimeDebt`/`profile:spendBank` → Insights economy cards | ✅ |

## 3. Floating timer widget

| Requirement | Delivered functions / modules | Status |
|---|---|---|
| Always-on-top floating window, times one task | `createWidgetWindow` (`main.js`); `TimerWidget.jsx` | ✅ |
| Single active task app-wide | `timerService.play(taskId)` (commits + stops prior) | ✅ |
| Crash/sleep-safe time (no inflated totals) | `creditElapsed` sleep-clamp; 5s flush delta vs `flushedThisSession`; `flushToDb` self-heal | ✅ |
| Zustand-equivalent renderer mirror | `src/widget/timerStore.js` (`createStore`/`useTimerStore`) | ✅ |
| "Tanking Boredom" resistance timer | `startBoredom`/`stopBoredom`/`creditBoredom`; `onBoredomEnd` → `logBoredom` | ✅ |

## 4. Insights, smart queue & adaptive model

| Requirement | Delivered functions / modules | Status |
|---|---|---|
| Surface completions / time / accuracy / streak | `getCompletionStats`; `InsightsScreen.jsx`; `Charts.jsx` (`BarRow`, `Heatmap`) | ✅ |
| Priority queue by leverage + urgency | `computePriority`, `getActiveTaskQueue`, `getQuadrantSlipMap`; Priority↔Date toggle | ✅ |
| Learn reliability, slip-risk, daily capacity | `getReliabilityStats`, `getScheduleLoad`; `src/lib/behaviorModel.js` (`learnedCapacity`, `realisticMinutes`, `dayLoadStatus`, `soonestOpenDay`) | ✅ |
| Overload warning + "lighter day" suggestion | New-task overload warning; "On your plate now" meter; Slip-prone chip | ✅ |

## 5. Reminders & data safety

| Requirement | Delivered functions / modules | Status |
|---|---|---|
| OS notifications for due/overdue tasks | `reminderService.check` → `db.getDueTasks`; gated on `notifications_enabled` | ✅ |
| Keep firing when window is closed | `Tray` in `main.js`; `window-all-closed` no longer quits on Windows | ✅ |
| Backup / restore DB + profile | `data:export` / `data:import` (`dialog` + `fs`, `app.relaunch()`) | ✅ |

## 6. AI planning & web guide (optional)

| Requirement | Delivered functions / modules | Status |
|---|---|---|
| "Big vague goal" → milestone/task breakdown | `AI_Service.js` + `ollamaClient.js` (Ollama `llama3`); degrades if offline | ✅ |
| Live-web step-by-step how-to | `guideService.js` + `tavilyClient.js` (Tavily); `GuideScreen.jsx` | ✅ |
| Tavily key never logged / never sent to renderer | `TAVILY_API_KEY` env or in-app KeyPrompt; main-process only | ✅ |

## 7. Lock In mode (opt-in strict tone, formerly "Unga Bunga")

| Requirement | Delivered functions / modules | Status |
|---|---|---|
| Commercial-friendly rename, no profile migration | UI strings → "Lock In"; internal `tone_preference === 'unga_bunga'` unchanged | ✅ |
| Confrontational timer prompts | `confront` state in `TimerWidget.jsx`; copy in `src/lib/tone.js` | ✅ |
| Defense-mechanism picker instead of free text | `TimeDebtJustificationModal.jsx`; `DEFENSE_MECHANISMS` | ✅ |
| Reward inversion (Bank locks; streak-only) | `recordTaskCompletion` `bank_locked` | ✅ |
| Post-overrun punishment menu | `penaltyPending`; `PunishmentModal.jsx`; `rollPunishments` (`src/lib/punishments.js`); `servePunishment` | ✅ |
| Single-task lockdown that hides everything | computed `focus_lock`; `FocusLockScreen.jsx`; `normalizeProfile` auto-clears penalty locks next day | ✅ |

## 8. Leisure Loan (commitment device)

| Requirement | Delivered functions / modules | Status |
|---|---|---|
| Borrow play time now, set the amount | `startLeisureLoan`; `LeisureLoanScreen.jsx` borrow form | ✅ |
| Repay as forced focus at 1.25× interest | `beginLeisureRepay` (timed `focus_lock` `reason:'leisure_loan'` + `expires_at`) | ✅ |
| Good-behavior gate + once/day (2 when consistent) | `leisureLoanStatus` (streak ≥3 unlock; cap 20→30 min + 2nd use at ≥7) | ✅ |
| Prep ritual before repay | `beginLeisurePrep` (≤5 min PREP phase) | ✅ |
| Impossible to dodge by quitting | `normalizeLeisureLoan` (daily reset · escape-proof arm-on-reopen · timed release) | ✅ |

## 9. Prep phase & Follow-ups (sympathetic layer)

| Requirement | Delivered functions / modules | Status |
|---|---|---|
| Help the user *prepare* (tools, checklist, notes) | `PrepScreen.jsx`; `tasks.prep_json`; `ai:generatePrep` → `AI_Service.generatePrep` | ✅ |
| Track loose ends (submit-by-deadline) | `follow_ups` table; `followUpEngine.applyAnswer` `submit` flow | ✅ |
| "Email the professor, repeat until they reply" | `notify_wait` state machine (`pending`→`awaiting_reply`→`resolved`) | ✅ |
| Nudges work while other tasks run | `reminderService.checkFollowUps` (5-min loop) → `getDueFollowUps` | ✅ |
| Wait during Lock In, resume after | injected `isLocked()`; passes fire nothing **and** don't advance `next_nudge_at` | ✅ |
| Answer in-app (OS toast → inbox) | `onFollowUpActivate` → `navigateMain('followups')`; `FollowUpsInbox.jsx` | ✅ |
| App never actually sends/reads mail | `notify_wait` tracks *your* reported action only | ✅ |

## 10. Quick Note pad & Chores (low-friction capture)

| Requirement | Delivered functions / modules | Status |
|---|---|---|
| Always-openable note pad, low PC cost | `NotesScreen.jsx`; `notes` table (one insert, debounced persist) | ✅ |
| `/` slash-command classification | `src/lib/notes.js` `parseNoteInput`; live slash menu (`SLASH_COMMANDS`) | ✅ |
| `/plan` → Quick Capture | routes `{name:'capture', initialText}`; `CaptureScreen` `initialText` prop | ✅ |
| `/chore` (once) & `/daily` (repeating) → reminders | `chores` table; `createChore`/`markChoreDone`/`getDueChores`; `checkChores` pass | ✅ |
| Daily chore resets each day, optional time | `getDueChores` (`last_done_date < today`, `time_of_day` gate) | ✅ |
| User can modify/pause/delete chores | Chores tab: inline edit, `active` pause/resume, delete | ✅ |
| Batch "process" boundary + Select all | `getOpenClassifiedNotes`; checkboxes + Select all → `processSelected` | ✅ |
| Silent during a focus lock | shared `isLocked` gate in `checkChores` | ✅ |

---

## Cross-cutting achievements

- **Zero new runtime dependencies** across every feature — only `react`,
  `react-dom`, `sql.js`, `electron`, `vite`. All charts, state machines, and the
  Zustand-equivalent store are hand-rolled.
- **Security posture:** `contextIsolation: true`, `nodeIntegration: false`; the
  renderer touches Node/DB only through the `window.api` bridge. No secret is
  logged or forwarded to the renderer (audited — no matches).
- **Data safety:** atomic writes (`*.tmp` + `renameSync`); debounced persist with
  `immediate` flush at durability points; migrations are additive and idempotent
  (verified by re-init boot smoke).

## Verification evidence (2026-08-01)

| Check | Result |
|---|---|
| `parseNoteInput` + notes/chores CRUD (`test-notes.mjs`) | 24/24 |
| Adaptive model (`test-adaptive.mjs`) | 22/22 |
| Follow-ups engine (`test-followups.mjs`) | 19/19 |
| Leisure Loan (`test-leisure.mjs`) | 26/26 |
| Lock In tone (`test-unga.mjs`) | 43/43 |
| Insights/queue/economy (`test-upgrade.mjs`) | 31/31 |
| `node --check` on all 8 main-process files | clean |
| `vite build` (index.html + widget.html) | clean, main bundle 83 kB |
| Headless boot smoke (real `database.js`) | clean |

## Known gaps for commercial release (not feature bugs)

| Gap | Impact | Fix |
|---|---|---|
| ⛔ No packaging/installer config | Cannot ship a `.exe`/`.dmg` to end users | Add `electron-builder`, a `dist:app` script, `appId`/`productName` |
| ⛔ No application icon (only `tray.png`) | Generic Electron icon in taskbar/installer | Add `build/icon.ico` + `.icns` |
| ⛔ No code signing / auto-update | SmartScreen warnings; no update path | Signing cert + `electron-updater` feed |
| ⛔ No LICENSE / privacy statement | Legal blocker for distribution | Choose a license; publish privacy note (local-first is a selling point) |
| ⚠️ Packaged paths assume dev layout | `dist`/`build` resolved via `__dirname/..`; verify inside asar | Confirm `files`/`extraResources` when packaging |
| ⚠️ `MODULE_TYPELESS_PACKAGE_JSON` warning | Harmless perf warning on `.js` ESM imports | (optional) add `"type": "module"` or rename to `.mjs` |
