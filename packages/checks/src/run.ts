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
    check.run(repo).map((violation) => ({ checkId: check.id, violation }))
  );
}

// Each worker reads its own inputs and parses the SQL itself, so a worker costs
// memory (about 0.4 GB) and repeats work. Measured on a busy 14-core machine,
// 4 workers were faster than 2, and 6 were slower than 4.
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
 * `checkIds` grouped by the input each check declares first, each group in
 * `checkIds` order. A check that declares nothing is a group of its own.
 */
function groupByFirstInput(checkIds: readonly string[]): string[][] {
  const groups = new Map<unknown, string[]>();
  for (const checkId of checkIds) {
    const check = CHECKS.find((candidate) => candidate.id === checkId);
    const input = check?.reads[0] ?? checkId;
    const group = groups.get(input);
    if (group) group.push(checkId);
    else groups.set(input, [checkId]);
  }
  return [...groups.values()];
}

/**
 * What the checks of `CHECKS` named by `checkIds` find under `root`, run on
 * `workers` worker threads, in `checkIds` order. Each worker takes the next id
 * when it finishes one, from the checks that declare the same first input.
 * Rejects, naming the check, when a check throws.
 */
export function findOnWorkers(
  checkIds: readonly string[],
  root: string,
  workers: number
): Promise<Finding[]> {
  const groups = groupByFirstInput(checkIds);
  const groupOf = new Map<Worker, string[]>();
  // Each worker has its own loader and SQL-parse caches, so an input is read
  // and parsed again on every worker that runs a check of it. The groups come
  // from what the checks declare, so no check runs to be grouped; a check that
  // also reads the migrations declares them first, to share their parse. A
  // worker keeps to its group, then takes the largest group no other worker is
  // on. It does not help with a group another worker has: reading that
  // group's input again took longer than the help saved.
  const nextFor = (worker: Worker): string | undefined => {
    let group = groupOf.get(worker);
    if (!group?.length) {
      const left = groups
        .filter((candidate) => candidate.length > 0)
        .sort((a, b) => b.length - a.length);
      const taken = new Set(groupOf.values());
      group = left.find((candidate) => !taken.has(candidate));
      if (!group) return undefined;
      groupOf.set(worker, group);
    }
    return group.shift();
  };
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
        const next = nextFor(worker);
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
