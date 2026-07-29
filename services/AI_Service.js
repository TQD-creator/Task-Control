// Local LLM Service Layer — talks to a local Ollama instance to turn the
// user's "Big Vague Goal" into a structured Milestone/Task breakdown,
// personalized via the user_profile.json Personalization Engine (Step 3).

// NOTE on host: `localhost` only resolves to the device itself.
//  - iOS Simulator: localhost works.
//  - Android Emulator: use 10.0.2.2 instead of localhost.
//  - Physical device: use your machine's LAN IP, e.g. http://192.168.1.20:11434
const OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3';
const REQUEST_TIMEOUT_MS = 60000;

// ---------------------------------------------------------------------------
// Prompt Builder
// Reads the user_profile.json shape (see profile/profileEngine.js) and turns
// it into a system prompt so the model's tone, risk tolerance, and awareness
// of the user's current Time Debt / Guilt-Free Bank shape its plan.
// ---------------------------------------------------------------------------

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

export function buildSystemPrompt(profile) {
  const { personalization, time_economy, estimation_calibration, streaks } = profile;

  const calibrationText = describeCalibration(estimation_calibration);

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

User personalization:
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

function buildUserPrompt(bigVagueGoal) {
  return `Big Vague Goal: "${bigVagueGoal}"\n\nDecompose this into milestones and tasks as instructed.`;
}

// ---------------------------------------------------------------------------
// Ollama call
// ---------------------------------------------------------------------------

async function callOllamaChat(messages, { model = DEFAULT_MODEL } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${REQUEST_TIMEOUT_MS}ms. Is it still generating?`);
    }
    throw new Error(
      `Could not reach Ollama at ${OLLAMA_BASE_URL}. Make sure it's running (\`ollama serve\`) and reachable from this device.`
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama returned ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.message?.content ?? '';
}

// Turns a Big Vague Goal into a { milestones: [...] } structure, personalized
// via the given profile. Throws if Ollama is unreachable or returns non-JSON.
export async function generateMilestonePlan(bigVagueGoal, profile, options = {}) {
  const systemPrompt = buildSystemPrompt(profile);
  const userPrompt = buildUserPrompt(bigVagueGoal);

  const content = await callOllamaChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    options
  );

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Ollama response was not valid JSON:\n${content}`);
  }
}
