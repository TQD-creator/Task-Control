// Tavily search wrapper — the "Crawler" half of the live-web RAG pipeline.
// Tavily is purpose-built for LLM retrieval: it returns already-extracted,
// cleaned page text (the `content` field), so there's no HTML scraping to do
// here. https://docs.tavily.com/documentation/api-reference/endpoint/search

const { getTavilyKey } = require('../settings');

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const SEARCH_TIMEOUT_MS = 30000;

// Thrown when no API key is configured, so the caller (and ultimately the UI)
// can prompt the user to add one rather than showing a generic failure.
class MissingTavilyKeyError extends Error {
  constructor() {
    super('No Tavily API key configured. Add one in Settings (or set TAVILY_API_KEY).');
    this.name = 'MissingTavilyKeyError';
  }
}

// Returns [{ title, url, content, score }] for the top results, most relevant
// first. `content` is Tavily's cleaned extract, ready to hand to the LLM.
async function search(query, { maxResults = 5 } = {}) {
  const apiKey = getTavilyKey();
  if (!apiKey) throw new MissingTavilyKeyError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: 'advanced', // fuller extracts, better for synthesis
        include_answer: false,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Tavily search timed out after ${SEARCH_TIMEOUT_MS}ms.`);
    }
    throw new Error(`Could not reach Tavily: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
    throw new Error('Tavily rejected the API key (401). Check that it is correct.');
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Tavily returned ${response.status}: ${body}`);
  }

  const data = await response.json();
  return (data.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    content: r.content ?? '',
    score: r.score ?? 0,
  }));
}

module.exports = { search, MissingTavilyKeyError };
