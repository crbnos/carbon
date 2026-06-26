import { join, resolve } from "node:path";

/**
 * The single owner of the loop artifact layout. Every loop path is constructed
 * here — nothing else in the harness should hardcode `llm/loops/...`.
 *
 *   llm/loops/            committed docs (README, design)        — TRACKED
 *   llm/loops/runs/<id>/  one loop run's ephemeral artifacts     — GITIGNORED
 *     binding.loop.md     the binding the run was driven from
 *     ledger.jsonl        append-only per-iteration record
 *     run.log.jsonl       full event log
 *     outcome.json        the final LoopOutcome (machine-readable result)
 *     screenshots/        behavior-gate captures
 *
 * Keeping all runtime under one wholesale-ignored `runs/` dir is what keeps the
 * `llm/` tree clean: docs are tracked by default, runtime can't leak into git,
 * and `pruneRuns` (see runs.ts) has one place to GC.
 */

/** Repo-relative root for committed loop docs. */
export const LOOPS_DIR = "llm/loops";
/** Repo-relative root for ephemeral per-run artifacts (gitignored wholesale). */
export const RUNS_DIR = "llm/loops/runs";

/** Absolute dir holding one run's artifacts. */
export function runDir(cwd: string, id: string): string {
  return resolve(cwd, RUNS_DIR, id);
}

/** The binding the run was driven from (persisted for inspection / re-entry). */
export function bindingPath(cwd: string, id: string): string {
  return join(runDir(cwd, id), "binding.loop.md");
}

/** Append-only per-iteration ledger. */
export function ledgerPath(cwd: string, id: string): string {
  return join(runDir(cwd, id), "ledger.jsonl");
}

/** Full event log (every stdout line, mirrored to disk). */
export function logPath(cwd: string, id: string): string {
  return join(runDir(cwd, id), "run.log.jsonl");
}

/** The final LoopOutcome — what an external orchestrator reads instead of stdout. */
export function outcomePath(cwd: string, id: string): string {
  return join(runDir(cwd, id), "outcome.json");
}

/** Local dir the behavior gate captures screenshots into. */
export function screenshotsDir(cwd: string, id: string): string {
  return join(runDir(cwd, id), "screenshots");
}

/**
 * Repo-relative path a screenshot is hosted at on the shared `loop-artifacts`
 * branch (NOT the product tree). Mirrors the runtime layout so the hosted path
 * is stable and unique per run.
 */
export function hostedScreenshotPath(id: string, name: string): string {
  return `${RUNS_DIR}/${id}/screenshots/${name}`;
}
