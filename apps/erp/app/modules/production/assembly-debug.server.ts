import { appendFileSync } from "node:fs";

// TEMPORARY debugging instrumentation for the assembly step save/motion bug.
// Writes one JSON line per server action hit so we can see exactly which route
// fires (new vs update vs motion) and with what payload. Remove once resolved.
const LOG_PATH =
  "/Users/barbinbrad/Code/carbon-claude-confident-maxwell-dy4fvr/.ai/scratch/e2e/assembly-step-debug.jsonl";

export function logAssemblyStep(
  event: string,
  payload: Record<string, unknown>
) {
  try {
    appendFileSync(
      LOG_PATH,
      `${JSON.stringify({ at: new Date().toISOString(), event, ...payload })}\n`
    );
  } catch {
    // best-effort; never break the request
  }
}

/** Read a request's form data and return both the entries (for logging) and a
 * re-usable FormData clone the validator can consume. */
export async function readAndLogFormData(request: Request, event: string) {
  const formData = await request.formData();
  const entries: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    entries[key] =
      typeof value === "string"
        ? value.length > 300
          ? `${value.slice(0, 300)}…`
          : value
        : "[file]";
  }
  logAssemblyStep(event, { url: request.url, entries });
  return formData;
}
