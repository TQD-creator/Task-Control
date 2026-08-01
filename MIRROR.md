# Mirror Project

> **Status: planned / not yet built.** This document is the build plan and
> architecture for **Mirror**, a *separate* companion project to Task Control.
> Nothing here is implemented in the Task Control repo yet — the sections below
> describe the target design to build against, not current code.

Mirror is a local, non-clinical self-insight app. It reads a Task Control export,
computes deterministic behavior features, optionally blends in Mini-IPIP quiz
answers, and then turns the result into a psychology-informed reflection report.

## What The Project Does

Mirror follows a strict pipeline:

1. Ingest a Task Control export folder.
2. Read `task_control.db` and `user_profile.json` locally.
3. Compute features from task history, calibration, streaks, and the time-economy ledger.
4. Map features into constructs such as Big Five traits, procrastination, and avoidance style.
5. Rank named archetypes such as Steady Finisher or Optimistic Overcommitter.
6. Optionally blend Mini-IPIP quiz answers into the Big Five scores.
7. Generate report prose locally, with Ollama if available, or a deterministic fallback if not.
8. Render a self-contained HTML report or show it in the Electron shell.

The important design rule is that the core scoring is **deterministic**. The
language model is only used to *phrase* the report, not to decide the scores.

## How To Get The Input From Task Control

Mirror does not scrape the Task Control UI. It reads the same local data files
that Task Control already stores on disk.

### Preferred Input Source

Use a Task Control export folder that contains exactly these two files:

- `task_control.db`
- `user_profile.json`

This is exactly what Task Control's in-app **Backup / Export** (`data:export`)
produces — a timestamped folder holding those two files and nothing else.

### Where Task Control Stores Its Data

On Windows, Task Control stores its active data under the user app-data
directory (the Electron app name is `task-control-desktop`):

- `%APPDATA%\task-control-desktop\`

That is the place to look for the live database and profile files.

### If You Want A Safer Workflow

The safest workflow is to **export or copy** a folder that contains those two
files, then point Mirror at that copy. Mirror only reads the source files and
never writes back into Task Control's directory. (The generated `report.html` is
written into the chosen export folder — the copy — never into Task Control's
live data dir.)

### What Mirror Expects

Mirror expects the export folder to contain:

- `task_control.db` with the `tasks`, `milestones`, and `goals` tables.
  - Task deadline is `scheduled_date` only (`due_date` lives on `milestones`).
  - Key task columns: `effort`, `impact`, `status`, `scheduled_date`,
    `estimated_minutes`, `actual_minutes`, `time_debt_delta`, `total_seconds`,
    `completed_at`.
- `user_profile.json` with personalization, the time-economy `ledger`,
  calibration buckets, and streaks.
  - Ledger entry types: `debt` (carries `defense_mechanism` ∈
    `dopamine`/`over_complicate`/`hope_panic`), `bank`, `bank_locked`,
    `debt_repayment`, `boredom_tank`, `punishment`.
  - `estimation_calibration`: 4 quadrant buckets, each
    `{ sample_count, avg_actual_to_estimate_ratio }` (ratio > 1 = chronic
    underestimation).

If either file is missing, Mirror should stop early with a clear validation error.

## How The Mirror Build Is Designed To Work

### Engine Pipeline

- `src/engine/ingest.js` reads the export folder and converts it into a plain
  dataset (the only module that touches `sql.js`, so everything downstream is
  testable from plain fixtures).
- `src/engine/features.js` turns the dataset into feature signals.
- `src/engine/constructs.js` maps those signals to constructs (each with a
  confidence and an evidence list).
- `src/engine/archetypes.js` ranks the named archetypes.
- `src/engine/quiz.js` scores the 20-item Mini-IPIP questionnaire.
- `src/engine/narrator.js` writes report prose with an Ollama call or fallback
  template.
- `src/report/index.js` renders the final self-contained HTML report.

### CLI

Run the analyzer like this:

```bash
npm run analyze -- <export-folder>
```

That generates `report.html` inside the export folder.

### Electron Shell

The Electron shell is a thin wrapper over the same engine:

- Load screen: choose the export folder.
- Questionnaire screen: answer the Mini-IPIP items or skip them.
- Report screen: view the rendered report and the top archetypes.

## Planned Implementation

The target feature set to build (none of this exists yet):

- Read-only SQLite ingestion via `sql.js`.
- Deterministic feature extraction.
- Construct scoring with confidence values.
- Archetype ranking.
- Mini-IPIP quiz scoring.
- Quiz merge path for Big Five.
- Ollama-based narration with a fallback template.
- Standalone HTML report rendering.
- Electron shell with load, questionnaire, and report screens.

## Build Order (each phase is independently runnable)

1. **Engine core (headless):** `ingest → features → constructs → archetypes`,
   verifiable via a fixture test harness. Start here.
2. **Mini-IPIP:** the 20 public-domain items, scoring, and the Big Five merge rule.
3. **Narrator:** Ollama prompt + guardrails + deterministic fallback template.
4. **Report + CLI:** self-contained HTML renderer wired into `npm run analyze`.
5. **Electron shell:** load / questionnaire / report screens over the CLI engine.

Phases 1–4 give a working CLI product before any UI exists.

## Missing Steps

The main gaps to complete once the core is up:

1. A real export-folder validator with clearer error messages in the Electron UI.
2. Fixture-based tests for `ingest.js` using a sample Task Control export shape.
3. A sample report preview state for when no export is selected yet.
4. More framework citations and claim-level evidence formatting in the report.
5. A small import-helper in Mirror that explains exactly where Task Control
   stores the input on Windows.
6. An actual packaged desktop app build workflow if this needs to be shipped.

## Future Update Steps

### Phase 2

- Tighten the validation layer around `task_control.db` and `user_profile.json`.
- Improve the report formatting for evidence, confidence, and framework citations.
- Add better loading and empty-state UX in the Electron shell.

### Phase 3

- Add more synthetic golden fixtures for archetype coverage.
- Add a real sample export fixture for end-to-end testing.
- Improve the prompt guardrails and narration fallback details.

### Phase 4

- Expand the report with stronger visuals and claim-by-claim explanations.
- Add optional persistence for saved analyses.
- Add packaging and distribution steps for the Electron app.

### Phase 5

- If needed, connect the shell to the full desktop build pipeline.
- Add onboarding text that shows where to find the Task Control export on disk.
- Add versioned schema checks so Mirror can handle future Task Control changes safely.

## Safety Rules

- **Read-only only.** Mirror must not write into Task Control's data directory.
- **Local only.** No cloud upload and no hidden network dependency for the core
  analysis (Ollama is local).
- **Non-clinical.** The app talks about tendencies, not disorders. No diagnostic
  or mental-illness labels.
- **Evidence first.** Every meaningful claim is tied to observable data and a
  confidence level, and cites the framework it draws on.

## Short Summary

Task Control supplies the input locally through its SQLite database and JSON
profile. Mirror reads those files, scores the behavior model deterministically,
optionally blends in quiz answers, and produces a local, non-clinical reflection
report.
