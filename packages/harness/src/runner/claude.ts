import { spawnSync } from "node:child_process";
import type { ClaudeRequest, ClaudeResult } from "./types";

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Invoke `claude -p` headless and return the final text + cost. Runs with
 * `bypassPermissions` (the loop runs in an isolated worktree with a powerless
 * token; PreToolUse hooks are the real guardrail) and hard turn/budget caps so a
 * wedged session dies instead of spinning. `spawnSync` (no shell) passes the
 * prompt as a single argv element, so no escaping is needed.
 */
export function claude(req: ClaudeRequest): ClaudeResult {
  const args = [
    "-p",
    req.prompt,
    "--output-format",
    "json",
    "--permission-mode",
    "bypassPermissions",
    "--max-turns",
    String(req.maxTurns),
    "--max-budget-usd",
    String(req.maxBudgetUsd)
  ];
  const model = process.env.CONDUCTOR_MODEL;
  if (model) args.push("--model", model);

  const res = spawnSync("claude", args, {
    cwd: req.cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER
  });
  if (res.error)
    throw new Error(`claude failed to spawn: ${res.error.message}`);

  // `claude --output-format json` prints a result object even on a NON-ZERO
  // exit (a hit `--max-turns`/`--max-budget-usd` exits non-zero with
  // `is_error:true, subtype:"error_max_turns"|...`). Salvage it: a capped run
  // is a soft outcome the caller's parser handles, not a process crash. Only a
  // genuinely empty/unparseable stdout is fatal.
  let parsed:
    | {
        result?: string;
        total_cost_usd?: number;
        session_id?: string;
        is_error?: boolean;
        subtype?: string;
      }
    | undefined;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    parsed = undefined;
  }
  if (!parsed) {
    throw new Error(
      `claude exited ${res.status} with no JSON result: ${(res.stdout || res.stderr || "").slice(0, 2000)}`
    );
  }
  return {
    text: parsed.result ?? "",
    costUsd: parsed.total_cost_usd ?? 0,
    sessionId: parsed.session_id ?? "",
    incomplete: parsed.is_error === true,
    stopReason: parsed.subtype
  };
}
