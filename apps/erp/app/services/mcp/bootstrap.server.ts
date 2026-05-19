import { McpToolRegistry } from "./registry";

// Idempotent: invokes the generator-emitted registerAll() once per process,
// which imports every annotated service file (triggering the wrapper's
// symbol-tag side effect) and calls registerParsed() for every tool. Called
// from /api/mcp on first request; subsequent calls are cheap (cached promise).
let loadPromise: Promise<number> | null = null;

export function ensureMcpToolsLoaded(): Promise<number> {
  if (loadPromise) return loadPromise;
  loadPromise = loadAnnotatedServices().catch((err) => {
    loadPromise = null;
    throw err;
  });
  return loadPromise;
}

async function loadAnnotatedServices(): Promise<number> {
  // Lazy import so test environments (and tooling) that exercise the registry
  // directly don't pay the cost of pulling in every service module.
  const { registerAll } = await import("./mcp-tools.generated.server");
  registerAll();
  const size = McpToolRegistry.getInstance().size();
  console.log(`[mcp] loaded ${size} annotated tools into registry`);
  return size;
}
