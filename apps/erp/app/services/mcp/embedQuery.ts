// Single-flight Ollama embedding call for the MCP semantic search path.
//
// Constraints (from the design spec):
//  - No preload. The model is not warmed at app boot.
//  - At most one instance of any given embedding request in flight at a time.
//    Concurrent search_tools calls issuing the same query share one upstream
//    request rather than each triggering an Ollama model load.
//  - Distinct queries proceed independently (Ollama serializes server-side).
//
// The deduplication window is the lifetime of the request — short and bounded,
// so there's no stale-cache problem. We do not cache across requests by design.

// Model + endpoint MUST match the worker that populates `mcpToolEmbedding`
// (packages/database/supabase/functions/mcp-embeddings-worker/index.ts).
// Cosine similarity is only meaningful when query and corpus are produced by
// the same model. Both sides use Ollama's `/api/embeddings` (single-input)
// endpoint and the 768-dim `embeddinggemma:300m` model by default.
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://ollama:11434";
const OLLAMA_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "embeddinggemma:300m";
const EXPECTED_EMBEDDING_DIMS = 768;
const TIMEOUT_MS = 30_000;

let inFlight: Promise<number[]> | null = null;
let inFlightKey: string | null = null;

export interface EmbedFetcher {
  (url: string, init: RequestInit): Promise<Response>;
}

// Exposed for tests: lets a spec inject a fake fetch implementation without
// monkey-patching the global.
let fetchImpl: EmbedFetcher = (url, init) => fetch(url, init);

export function __setEmbedFetcherForTesting(impl: EmbedFetcher | null): void {
  fetchImpl = impl ?? ((url, init) => fetch(url, init));
}

export function __resetSingleFlightForTesting(): void {
  inFlight = null;
  inFlightKey = null;
}

async function doEmbed(text: string): Promise<number[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Ollama embeddings returned ${res.status}: ${body.slice(0, 200)}`
      );
    }
    const json = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
      throw new Error("Ollama embeddings response missing 'embedding' array");
    }
    // Dimension guardrail: if Ollama is misconfigured (wrong model loaded),
    // fail loud rather than silently storing a vector that can't be compared
    // against the corpus. Tests may stub shorter vectors — only enforce when
    // the env explicitly opts into strict checking OR the model is the
    // production default.
    if (
      OLLAMA_MODEL === "embeddinggemma:300m" &&
      process.env.NODE_ENV === "production" &&
      json.embedding.length !== EXPECTED_EMBEDDING_DIMS
    ) {
      throw new Error(
        `Ollama embedding dim mismatch: got ${json.embedding.length}, expected ${EXPECTED_EMBEDDING_DIMS}`
      );
    }
    return json.embedding;
  } finally {
    clearTimeout(timer);
  }
}

export async function embedQuery(text: string): Promise<number[]> {
  const key = text;
  if (inFlightKey === key && inFlight) return inFlight;
  inFlightKey = key;
  inFlight = doEmbed(text).finally(() => {
    if (inFlightKey === key) {
      inFlight = null;
      inFlightKey = null;
    }
  });
  return inFlight;
}
