// Local LLM Service Layer — Electron main-process port of the React Native
// AI_Service.js. Runs in the main process (Node, not Chromium) so calling
// Ollama on localhost is a plain server-to-server request with no CORS
// restrictions to work around. The low-level HTTP/parse plumbing lives in
// ollamaClient.js, shared with guideService.js.

const { callOllamaChat, parseJsonResponse } = require('./ollamaClient');

// JSON Schemas passed as Ollama's `format` parameter. Ollama constrains the
// model's token generation to match these at the grammar level (structured
// outputs), so an invalid enum value or a missing required field becomes
// structurally impossible to emit — much stronger than asking nicely in the
// prompt text, which is what let llama3.2:3b return "impact": "very high"
// and omit fields on tasks entirely during testing.
const TASK_SCHEMA = {
  type: 'object',
  required: ['title', 'action', 'artifact', 'effort', 'impact', 'day_offset', 'estimated_minutes'],
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    action: { type: 'string' },
    artifact: { type: 'string' },
    effort: { type: 'string', enum: ['low', 'high'] },
    impact: { type: 'string', enum: ['low', 'high'] },
    day_offset: { type: 'integer' },
    estimated_minutes: { type: 'integer' },
  },
};

const MILESTONE_SCHEMA = {
  type: 'object',
  required: ['title', 'action', 'artifact', 'effort', 'impact', 'day_offset', 'tasks'],
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    action: { type: 'string' },
    artifact: { type: 'string' },
    effort: { type: 'string', enum: ['low', 'high'] },
    impact: { type: 'string', enum: ['low', 'high'] },
    day_offset: { type: 'integer' },
    tasks: { type: 'array', items: TASK_SCHEMA },
  },
};

const MILESTONE_PLAN_FORMAT = {
  type: 'object',
  required: ['milestones'],
  additionalProperties: false,
  properties: {
    milestones: { type: 'array', items: MILESTONE_SCHEMA },
  },
};

const CAPTURE_FORMAT = {
  type: 'object',
  required: ['goal', 'milestones'],
  additionalProperties: false,
  properties: {
    goal: {
      type: 'object',
      required: ['title', 'action', 'artifact'],
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        action: { type: 'string' },
        artifact: { type: 'string' },
      },
    },
    milestones: { type: 'array', items: MILESTONE_SCHEMA },
  },
};

function describeCalibration(calibration) {
  return Object.entries(calibration)
    .filter(([, bucket]) => bucket.sample_count > 0)
    .map(([bucket, { avg_actual_to_estimate_ratio, sample_count }]) => {
      const label = bucket.replace(/_/g, ' ');
      const pct = Math.round((avg_actual_to_estimate_ratio - 1) * 100);
      const direction = pct === 0 ? 'on target' : pct > 0 ? `underestimates by ~${pct}%` : `overestimates by ~${-pct}%`;
      return `- ${label} tasks (${sample_count} samples): ${direction}`;
    })
    .join('\n');
}

// Shared personalization/time-economy/calibration block used by every
// prompt that asks the model to plan or size work for this specific user.
function buildPersonalizationContext(profile) {
  const { personalization, time_economy, estimation_calibration, streaks } = profile;
  const calibrationText = describeCalibration(estimation_calibration);

  return `User personalization:
- Tone: ${personalization.tone_preference}
- Work hours: ${personalization.work_hours.start}-${personalization.work_hours.end}
- Peak energy windows: ${personalization.peak_energy_windows.join(', ') || 'unspecified'}
- Risk tolerance: ${personalization.risk_tolerance} (low = conservative estimates and small steps, high = ambitious stretch milestones)

Current time economy (weigh this when sizing new tasks):
- Time Debt: ${time_economy.time_debt_minutes} minutes owed
- Guilt-Free Bank: ${time_economy.guilt_free_bank_minutes} minutes banked
- Current streak: ${streaks.current_streak_days} days (longest: ${streaks.longest_streak_days})

Estimation accuracy history (bias your estimated_minutes to correct for these patterns):
${calibrationText || '- No history yet; estimate conservatively.'}

day_offset is in days relative to the parent's start date (0 = starts immediately).`;
}

function buildSystemPrompt(profile) {
  return `You are a planning assistant embedded in a personal task-control app.
Break down the user's goal into Milestones, and each Milestone into Tasks.

Respond with ONLY valid JSON matching this shape, no prose, no markdown fences:
{
  "milestones": [
    {
      "title": string,
      "action": string,
      "artifact": string,
      "effort": "low" | "high",
      "impact": "low" | "high",
      "day_offset": number,
      "tasks": [
        {
          "title": string,
          "action": string,
          "artifact": string,
          "effort": "low" | "high",
          "impact": "low" | "high",
          "day_offset": number,
          "estimated_minutes": number
        }
      ]
    }
  ]
}

${buildPersonalizationContext(profile)}`;
}

function buildUserPrompt(bigVagueGoal) {
  return `Big Vague Goal: "${bigVagueGoal}"\n\nDecompose this into milestones and tasks as instructed.`;
}

// "Quick Capture" prompt: input here is not a clean goal statement — it's a
// raw, possibly rambling note (a stray idea, a diary-style thought) tagged
// with a loose category. The model has to do two things in one pass: figure
// out what the actual goal is, then decompose it the same way
// generateMilestonePlan does. One combined call rather than a separate
// extract-then-plan pipeline, since chaining two local-model calls just adds
// latency and another place for a small model to drift off track.
function buildCaptureSystemPrompt(profile, category) {
  return `You are a planning assistant embedded in a personal task-control app.
The user just jotted down a raw, possibly messy or rambling personal note —
not a clean goal statement. It's tagged with the category "${category}".

First, figure out what they actually mean: a concise goal title, and an
Action/Artifact pair describing what "done" looks like (e.g. Action "Launch",
Artifact "a personal portfolio site"). If the note only makes sense as a
small single task rather than a whole goal, that's fine — still produce a
goal wrapper with exactly one milestone and one task.

Then decompose that goal into Milestones, and each Milestone into Tasks, the
same way you would for an explicit goal.

Respond with ONLY valid JSON matching this shape, no prose, no markdown fences:
{
  "goal": {
    "title": string,
    "action": string,
    "artifact": string
  },
  "milestones": [
    {
      "title": string,
      "action": string,
      "artifact": string,
      "effort": "low" | "high",
      "impact": "low" | "high",
      "day_offset": number,
      "tasks": [
        {
          "title": string,
          "action": string,
          "artifact": string,
          "effort": "low" | "high",
          "impact": "low" | "high",
          "day_offset": number,
          "estimated_minutes": number
        }
      ]
    }
  ]
}

${buildPersonalizationContext(profile)}`;
}

function buildCaptureUserPrompt(rawText, category) {
  return `Category: ${category}\n\nRaw note:\n"""\n${rawText}\n"""\n\nExtract the goal and decompose it as instructed.`;
}

async function generateMilestonePlan(bigVagueGoal, profile, options = {}) {
  const content = await callOllamaChat(
    [
      { role: 'system', content: buildSystemPrompt(profile) },
      { role: 'user', content: buildUserPrompt(bigVagueGoal) },
    ],
    { ...options, format: MILESTONE_PLAN_FORMAT }
  );
  return parseJsonResponse(content);
}

// Returns { goal: { title, action, artifact }, milestones: [...] } — the
// caller (renderer's CaptureReviewScreen) is responsible for letting the
// user edit/reject before any of it is written to the database.
async function analyzeCapture(rawText, category, profile, options = {}) {
  const content = await callOllamaChat(
    [
      { role: 'system', content: buildCaptureSystemPrompt(profile, category) },
      { role: 'user', content: buildCaptureUserPrompt(rawText, category) },
    ],
    { ...options, format: CAPTURE_FORMAT }
  );
  return parseJsonResponse(content);
}

module.exports = { buildSystemPrompt, generateMilestonePlan, analyzeCapture };
