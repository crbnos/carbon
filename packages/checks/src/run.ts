// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { keyOf, loadBaseline } from "./baseline";
import type { Check, Repo, Violation } from "./check";
import { CHECKS } from "./checks";
import { repoRoot } from "./sources/migrations";

export type Finding = { checkId: string; violation: Violation };

/** What `checks` find in `repo`, each violation under the id of its check. */
export function runChecks(checks: Check[], repo: Repo): Finding[] {
  return checks.flatMap((check) =>
    check.find(repo).map((violation) => ({ checkId: check.id, violation }))
  );
}

// Each worker reads its own inputs and parses the SQL itself. Measured on 14
// cores: 1 worker 17-19 s, 2 13-15 s, 4 11-12 s, 6 and 8 no faster and up to
// 3.6 GB peak, so more than 4 costs memory without saving time.
const MAX_WORKERS = 4;

const WORKER = fileURLToPath(new URL("./run.worker.ts", import.meta.url));
// The package runs its TypeScript source directly. tsx's ESM hooks do not reach
// a worker thread on Node 22 (`--import tsx` fails there), its require hook does.
const TSX = createRequire(import.meta.url).resolve("tsx/cjs");

type FromWorker =
  | { ready: true }
  | { checkId: string; violations: Violation[] }
  | { checkId: string; error: unknown };

/**
 * What the checks of `CHECKS` named by `checkIds` find under `root`, run on
 * `workers` worker threads, in `checkIds` order. Each worker takes the next id
 * when it finishes one. Rejects, naming the check, when a check throws.
 */
export function findOnWorkers(
  checkIds: readonly string[],
  root: string,
  workers: number
): Promise<Finding[]> {
  const queue = [...checkIds];
  const found = new Map<string, Violation[]>();
  let running = checkIds.length;
  const started: Worker[] = [];
  return new Promise<Finding[]>((resolve, reject) => {
    let settled = false;
    const settle = (result: Finding[] | Error) => {
      if (settled) return;
      settled = true;
      for (const worker of started) worker.terminate();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    if (checkIds.length === 0) return settle([]);

    for (let i = 0; i < Math.min(workers, checkIds.length); i++) {
      const worker = new Worker(WORKER, {
        workerData: { root },
        execArgv: ["--require", TSX]
      });
      started.push(worker);
      worker.on("message", (message: FromWorker) => {
        if ("error" in message) {
          const { checkId, error } = message;
          const reason = error instanceof Error ? error.message : String(error);
          return settle(
            new Error(`Check ${checkId} threw: ${reason}`, { cause: error })
          );
        }
        if ("violations" in message) {
          found.set(message.checkId, message.violations);
          running--;
        }
        const next = queue.shift();
        if (next !== undefined) worker.postMessage(next);
        else if (running === 0) {
          settle(
            checkIds.flatMap((checkId) =>
              (found.get(checkId) ?? []).map((violation) => ({
                checkId,
                violation
              }))
            )
          );
        }
      });
      worker.on("error", settle);
      worker.on("exit", (code) =>
        settle(new Error(`A check worker exited early (exit code ${code})`))
      );
    }
  });
}

/** Every finding of every check in `CHECKS` under `root`. */
export function collectFindings(root: string = repoRoot()): Promise<Finding[]> {
  return findOnWorkers(
    CHECKS.map((check) => check.id),
    root,
    Math.min(availableParallelism(), MAX_WORKERS)
  );
}

/** The findings that the committed baseline does not grandfather. */
export async function newViolations(): Promise<Finding[]> {
  const baseline = loadBaseline();
  return (await collectFindings()).filter(
    (f) => !baseline.has(keyOf(f.checkId, f.violation))
  );
}
