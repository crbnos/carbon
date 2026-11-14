// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { intro, log } from "@clack/prompts";
import pc from "picocolors";
import { confirmDestructive } from "../prompts.js";
import {
  bootSharedServices,
  ensureDockerRunning
} from "../services/compose.js";
import { currentStack } from "../stack.js";
import { teardown } from "../teardown.js";
import { readDevJwt } from "../worktree.js";
import { up } from "./up.js";

// Wipe this worktree's data, then boot it again. Orphaned stacks of deleted
// worktrees are `crbn prune`'s.
export async function reset() {
  intro("Carbon · dev reset");
  const stack = await currentStack();
  await ensureDockerRunning();

  await confirmDestructive(
    "Confirming a reset",
    `Destroy all volumes for ${pc.bold(stack.project)}? (postgres, storage, inngest data will be wiped, redis db flushed)`
  );
  log.warn(`resetting ${stack.project}`);

  // A reset that can't drop the database would keep the data.
  if (stack.recordedMode === "shared") {
    const warning = await bootSharedServices(readDevJwt());
    if (warning) log.warn(warning);
  }
  const failures = await teardown(stack, { volumes: true });
  if (failures.length > 0) throw new Error(failures.join("\n"));

  await up({ isolated: stack.mode === "isolated" });
}
