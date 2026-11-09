// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { intro, log, outro } from "@clack/prompts";
import { currentStack } from "../stack.js";
import { teardown } from "../teardown.js";

// No slug-in-use guard as in `up`: stopping your own stack must work for a
// moved, borrowed or stale worktree too, or its containers are orphaned.
export async function down(opts: { volumes?: boolean; purge?: boolean } = {}) {
  intro("Carbon · dev down");
  const failures = await teardown(await currentStack(), opts);
  for (const failure of failures) log.warn(failure);
  if (failures.length > 0) process.exitCode = 1;
  outro(opts.purge ? "stopped and purged" : "stopped");
}
