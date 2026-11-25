// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs checks for `findOnWorkers` (`run.ts`): it asks for a check id, runs that
// check over its own repo, posts the violations back and asks for the next.

import { parentPort, workerData } from "node:worker_threads";
import { CHECKS } from "./checks";
import { openRepo } from "./repo";
import { loadSqlParser } from "./sources/sql";

const byId = new Map(CHECKS.map((check) => [check.id, check]));

async function main() {
  const port = parentPort;
  if (!port) throw new Error("run.worker.ts runs as a worker thread");
  const { root }: { root: string } = workerData;
  await loadSqlParser();
  const repo = openRepo(root);
  port.on("message", (checkId: string) => {
    try {
      const check = byId.get(checkId);
      if (!check) throw new Error(`No check in CHECKS has the id ${checkId}`);
      port.postMessage({ checkId, violations: check.find(repo) });
    } catch (error) {
      port.postMessage({ checkId, error });
    }
  });
  port.postMessage({ ready: true });
}

main();
