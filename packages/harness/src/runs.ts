import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { outcomePath, RUNS_DIR, runDir } from "./layout";
import type { LoopOutcome } from "./runner/types";

/** A run on disk: its id, dir, parsed outcome (null if unfinished), and age. */
export type RunSummary = {
  id: string;
  dir: string;
  /** The final outcome, or null if the run never finished (no outcome.json). */
  outcome: LoopOutcome | null;
  mtimeMs: number;
};

/** Read one run's outcome.json, or null if it's absent / unparseable. */
export function readOutcome(cwd: string, id: string): LoopOutcome | null {
  try {
    return JSON.parse(
      readFileSync(outcomePath(cwd, id), "utf8")
    ) as LoopOutcome;
  } catch {
    return null;
  }
}

/** Every run dir under `llm/loops/runs/`, newest first. */
export function listRuns(cwd: string): RunSummary[] {
  let names: string[];
  try {
    names = readdirSync(join(cwd, RUNS_DIR));
  } catch {
    return []; // no runs/ dir yet
  }
  const runs: RunSummary[] = [];
  for (const name of names) {
    const dir = runDir(cwd, name);
    try {
      const stat = statSync(dir);
      if (!stat.isDirectory()) continue;
      runs.push({
        id: name,
        dir,
        outcome: readOutcome(cwd, name),
        mtimeMs: stat.mtimeMs
      });
    } catch {
      /* not a readable dir — skip */
    }
  }
  return runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export type PrunePolicy = {
  /** Always keep this many most-recent FINISHED runs regardless of age. */
  keepLast?: number;
  /** Prune finished runs older than this many days. */
  maxAgeDays?: number;
  /** Clock injection for tests; defaults to Date.now(). */
  now?: number;
};

/**
 * GC finished run dirs. **Unfinished runs (no outcome.json) are never pruned** —
 * they may be in-flight. This is the lever the OpenClaw janitor calls each
 * heartbeat to keep the box's disk from filling with stale loop artifacts.
 */
export function pruneRuns(
  cwd: string,
  policy: PrunePolicy = {}
): { removed: string[]; kept: number } {
  const keepLast = policy.keepLast ?? 20;
  const maxAgeDays = policy.maxAgeDays ?? 14;
  const now = policy.now ?? Date.now();
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;

  const finished = listRuns(cwd).filter((r) => r.outcome !== null); // newest first
  const removed: string[] = [];
  finished.forEach((r, i) => {
    if (i < keepLast) return; // within the keep-last window
    if (r.mtimeMs > cutoff) return; // still recent
    try {
      rmSync(r.dir, { recursive: true, force: true });
      removed.push(r.id);
    } catch {
      /* best-effort */
    }
  });
  return { removed, kept: finished.length - removed.length };
}
