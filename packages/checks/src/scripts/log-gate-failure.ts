// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Run by the pre-commit hook after the conformance gate fails: one
// `gate-failure` signal per new violation, for /learn and the weekly sweep.

import { execFileSync } from "node:child_process";
import { appendSignal } from "../learn/inbox";
import { newViolations } from "../run";
import { repoRoot } from "../sources/migrations";

const root = repoRoot();
const branch = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8"
    }).trim();
  } catch {
    return undefined;
  }
})();

const at = new Date().toISOString();
for (const { checkId, violation } of newViolations()) {
  appendSignal({
    kind: "gate-failure",
    at,
    worktree: root,
    branch,
    checkId,
    file: violation.file
  });
}
