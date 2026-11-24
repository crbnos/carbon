// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { keyOf, loadBaseline } from "./baseline";
import type { Check, Repo, Violation } from "./check";
import { CHECKS } from "./checks";
import { openRepo } from "./repo";
import { repoRoot } from "./sources/migrations";
import { loadSqlParser } from "./sources/sql";

export type Finding = { checkId: string; violation: Violation };

/** What `checks` find in `repo`, each violation under the id of its check. */
export function runChecks(checks: Check[], repo: Repo): Finding[] {
  return checks.flatMap((check) =>
    check.find(repo).map((violation) => ({ checkId: check.id, violation }))
  );
}

/** Every finding of every check in `CHECKS` under `root`. */
export async function collectFindings(
  root: string = repoRoot()
): Promise<Finding[]> {
  // The SQL checks read parsed SQL, and the parser loads asynchronously.
  await loadSqlParser();
  return runChecks(CHECKS, openRepo(root));
}

/** The findings that the committed baseline does not grandfather. */
export async function newViolations(): Promise<Finding[]> {
  const baseline = loadBaseline();
  return (await collectFindings()).filter(
    (f) => !baseline.has(keyOf(f.checkId, f.violation))
  );
}
