// Shared low-level Ollama client. Both AI_Service.js (goal/capture planning)
// and guideService.js (live-web RAG "Almighty Guide") call the local model
// through this one path, so the base URL, default model, timeout, structured-
// output plumbing, and JSON parsing live in exactly one place.

const OLLAMA_BASE_URL = 'http://localhost:11434';
// llama3 (8B) OOMs on this machine under normal memory pressure (16GB total,
// ~6GB free in practice) — llama3.2:3b fits comfortably instead.
const DEFAULT_MODEL = 'llama3.2:3b';
// Generous timeout for older/modest GPUs (this machine's Quadro M1200 is not
// fast) and for the model's first cold-start load into VRAM.
const REQUEST_TIMEOUT_MS = 180000;

// Passing `format` (a JSON Schema) constrains the model's token generation to
// match the schema at the grammar level — an invalid enum or missing required
// field becomes structurally impossible to emit, far stronger than asking for
// a shape in the prompt text.
async function callOllamaChat(messages, { model = DEFAULT_MODEL, format } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, format, stream: false }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${REQUEST_TIMEOUT_MS}ms. Is it still generating?`);
    }
    throw new Error(`Could not reach Ollama at ${OLLAMA_BASE_URL}. Make sure it's running (\`ollama serve\`).`);
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

function parseJsonResponse(content) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Ollama response was not valid JSON:\n${content}`);
  }
}

module.exports = { OLLAMA_BASE_URL, DEFAULT_MODEL, REQUEST_TIMEOUT_MS, callOllamaChat, parseJsonResponse };
