// The "Almighty Guide" — an agentic live-web RAG pipeline that turns one Step
// (a Task, in this app's schema) into a grounded, step-by-step tutorial.
//
// Reason -> Act -> Evaluate -> (retry) -> Synthesize:
//   1. FORMULATE  LLM turns Goal + Step into an optimized web search query.
//   2. SEARCH     Tavily fetches the top sources' cleaned text.
//   3. EVALUATE   LLM critiques whether those sources are enough to write the
//                 tutorial. If not (and retries remain) it proposes a better
//                 query and the loop returns to step 2.
//   4. SYNTHESIZE LLM writes the tutorial grounded ONLY in the retrieved text.
//
// Every LLM call on this machine is slow (~40-80s), so the loop is bounded by
// maxSearchAttempts and reports progress through an onProgress callback so the
// UI can show which phase it's in rather than freezing for minutes.

const { callOllamaChat, parseJsonResponse } = require('./ollamaClient');
const tavily = require('./tavilyClient');

const MAX_SOURCES = 5;
const MAX_SOURCE_CHARS = 1500; // truncate each source; big context is very slow here
const DEFAULT_MAX_SEARCH_ATTEMPTS = 2;

// ---------------------------------------------------------------------------
// Structured-output schemas (grammar-constrained; see ollamaClient.js)
// ---------------------------------------------------------------------------

const QUERY_FORMAT = {
  type: 'object',
  required: ['query'],
  additionalProperties: false,
  properties: { query: { type: 'string' } },
};

const EVALUATION_FORMAT = {
  type: 'object',
  required: ['sufficient', 'reason', 'better_query'],
  additionalProperties: false,
  properties: {
    sufficient: { type: 'boolean' },
    reason: { type: 'string' },
    // Empty string when sufficient is true; a rewritten query otherwise.
    better_query: { type: 'string' },
  },
};

const GUIDE_FORMAT = {
  type: 'object',
  required: ['title', 'summary', 'steps', 'caveats'],
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    steps: {
      type: 'array',
      // Floor of 3 so the grammar can't let a small model close the array after
      // one element and cram a numbered list into a single detail (the "only
      // Step 1" bug). Cap keeps synthesis from rambling on this slow machine.
      minItems: 3,
      maxItems: 8,
      items: {
        type: 'object',
        required: ['heading', 'detail'],
        additionalProperties: false,
        properties: {
          heading: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    // Things the retrieved sources did NOT cover or warned about — surfaced so
    // the model has an outlet other than inventing missing information.
    caveats: { type: 'array', items: { type: 'string' } },
  },
};

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

function describeStep(ctx) {
  const lines = [];
  // Category first: it frames the whole request (a "Creative" guitar goal wants
  // very different sources than a "Project Idea" software goal). Without it the
  // query formulation was generic — the "too naive, no project context" gap.
  if (ctx.goalCategory) lines.push(`Category: ${ctx.goalCategory}`);
  lines.push(`Goal: ${ctx.goalTitle}`);
  if (ctx.goalAction && ctx.goalArtifact) lines.push(`Goal means: ${ctx.goalAction} ${ctx.goalArtifact}`);
  if (ctx.goalDescription) lines.push(`Goal context: ${ctx.goalDescription}`);
  if (ctx.milestoneTitle) lines.push(`Milestone: ${ctx.milestoneTitle}`);
  lines.push(`Current step: ${ctx.stepTitle}`);
  if (ctx.stepAction && ctx.stepArtifact) lines.push(`Step means: ${ctx.stepAction} ${ctx.stepArtifact}`);
  return lines.join('\n');
}

function formatSourcesForPrompt(sources) {
  return sources
    .map((s, i) => `[Source ${i + 1}] ${s.title}\nURL: ${s.url}\n${(s.content || '').slice(0, MAX_SOURCE_CHARS)}`)
    .join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

async function formulateQuery(ctx) {
  const content = await callOllamaChat(
    [
      {
        role: 'system',
        content:
          'You turn a user\'s current task into ONE optimized web search query that would surface how-to ' +
          'documentation, tutorials, or forum answers for completing it. Prefer specific, current, ' +
          'jargon-correct terms over full sentences. Respond as JSON: { "query": string }.',
      },
      { role: 'user', content: `${describeStep(ctx)}\n\nWrite the best single search query for this step.` },
    ],
    { format: QUERY_FORMAT }
  );
  return parseJsonResponse(content).query;
}

async function evaluateSources(ctx, sources) {
  const content = await callOllamaChat(
    [
      {
        role: 'system',
        content:
          'You judge whether a set of web search results contains enough concrete, on-topic information ' +
          'to write a reliable step-by-step tutorial for the user\'s current step. If it does, set ' +
          'sufficient=true and better_query to "". If it does NOT (off-topic, too shallow, wrong version), ' +
          'set sufficient=false and provide an improved search query in better_query. Respond as JSON: ' +
          '{ "sufficient": boolean, "reason": string, "better_query": string }.',
      },
      {
        role: 'user',
        content: `${describeStep(ctx)}\n\nSearch results:\n\n${formatSourcesForPrompt(sources)}`,
      },
    ],
    { format: EVALUATION_FORMAT }
  );
  return parseJsonResponse(content);
}

async function synthesizeGuide(ctx, sources) {
  const content = await callOllamaChat(
    [
      {
        role: 'system',
        content:
          'You write a focused, actionable step-by-step tutorial for the user\'s CURRENT step only — not ' +
          'the whole goal. CRITICAL RULES:\n' +
          '- Break the process into 3 to 8 SEPARATE steps, in order. Each step is ONE discrete action.\n' +
          '- Put exactly one action in each step\'s "detail". NEVER put a numbered list ("1. ... 2. ...") ' +
          'inside a single detail — if you are numbering inside one detail, split it into more steps.\n' +
          '- "heading" is a short imperative title (e.g. "Tune your guitar"); "detail" is 1-3 sentences ' +
          'explaining how to do exactly that one action.\n' +
          '- Use ONLY information present in the provided sources. Do not add facts, versions, commands, or ' +
          'links that are not in the sources.\n' +
          '- If the sources lack something needed, do not invent it — list it under "caveats" instead.\n' +
          '- Stay strictly on the current step; ignore parts of the sources irrelevant to it.\n' +
          'Respond as JSON matching: { "title": string, "summary": string, "steps": ' +
          '[{ "heading": string, "detail": string }], "caveats": [string] }.',
      },
      {
        role: 'user',
        content: `${describeStep(ctx)}\n\nSources to base the tutorial on:\n\n${formatSourcesForPrompt(sources)}`,
      },
    ],
    { format: GUIDE_FORMAT }
  );
  return parseJsonResponse(content);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

// ctx: { goalTitle, goalAction, goalArtifact, milestoneTitle, stepTitle, stepAction, stepArtifact }
// onProgress(phase, extra?): 'formulating' | 'searching' | 'evaluating' | 'retrying' | 'synthesizing'
// Returns { guide, query, attempts, sources } — sources are returned so the UI
// can render citations next to the generated steps.
async function generateGuide(ctx, { maxSearchAttempts = DEFAULT_MAX_SEARCH_ATTEMPTS, onProgress = () => {} } = {}) {
  onProgress('formulating');
  let query = await formulateQuery(ctx);

  let sources = [];
  let attempts = 0;

  while (attempts < maxSearchAttempts) {
    attempts += 1;
    onProgress('searching', { query, attempt: attempts });
    sources = await tavily.search(query, { maxResults: MAX_SOURCES });

    // Last attempt: don't spend another slow LLM call critiquing — just use
    // what we have and synthesize.
    if (attempts >= maxSearchAttempts) break;

    onProgress('evaluating', { attempt: attempts });
    const evaluation = await evaluateSources(ctx, sources);
    if (evaluation.sufficient || !evaluation.better_query) break;

    onProgress('retrying', { reason: evaluation.reason });
    query = evaluation.better_query;
  }

  onProgress('synthesizing');
  const guide = await synthesizeGuide(ctx, sources);

  return { guide, query, attempts, sources };
}

module.exports = { generateGuide };
