// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync } from "node:fs";
import type { Task } from "@clack/prompts";
import { killOrphanedApps, killOrphanedStripe } from "./services/apps.js";
import { destroyProject, flushDb, stopStack } from "./services/compose.js";
import { releaseAliases } from "./services/portless.js";
import { dropWorktreeData } from "./services/shared-db.js";
import type { Stack } from "./stack.js";
import { tasks } from "./ui.js";
import { removeSlot, stackDatabase } from "./worktree.js";

type TeardownOptions = {
  /** Also wipe the stack's data: its volumes or worktree database, and its
   *  redis keys (cached permissions of users that no longer exist). */
  volumes?: boolean;
  /** Also release the slot: its ports and redis index go back to the pool. */
  purge?: boolean;
  /** Plain lines instead of spinners (after a Ctrl+C). */
  plain?: boolean;
};

/**
 * Stops a worktree's stack, and with `volumes` / `purge` removes it. Every
 * step runs even when one before it failed; the failures are returned.
 * Works for a worktree whose folder is gone too.
 */
export async function teardown(
  stack: Stack,
  opts: TeardownOptions = {}
): Promise<string[]> {
  const purge = opts.purge ?? false;
  const volumes = (opts.volumes ?? false) || purge;
  const { slot } = stack;
  const failures: string[] = [];
  const step = (
    title: string,
    run: () => Promise<string>,
    enabled = true
  ): Task => ({
    title,
    enabled,
    task: async () => {
      try {
        return await run();
      } catch (err) {
        const message = `${title}: ${(err as Error).message}`;
        failures.push(message);
        return `failed — ${message}`;
      }
    }
  });
  // Without its folder, compose has no files to read: remove by label.
  const hasFiles = existsSync(stack.root);
  const database = stackDatabase(stack.slug, "shared");

  await tasks(
    [
      step(`Stop ${stack.project}`, async () => {
        if (volumes || !hasFiles) {
          await destroyProject(stack.project, volumes);
        } else {
          await stopStack(stack);
        }
        return volumes ? "stack removed with its volumes" : "stack stopped";
      }),
      step(
        `Drop ${database}`,
        async () => {
          try {
            await dropWorktreeData(database);
          } catch (err) {
            // Without a slot, prune drops a database no slot owns.
            throw new Error(
              `${(err as Error).message}. ${purge ? "`crbn prune` drops it later." : "Run this again once crbn-shared runs."}`
            );
          }
          return `dropped ${database}`;
        },
        volumes && stack.recordedMode === "shared"
      ),
      step("Stop the dev servers", async () => {
        // Their cwd holds the folder open: `git worktree remove` fails on it.
        if (slot) await killOrphanedApps(slot.ports);
        if (hasFiles) await killOrphanedStripe(stack.root);
        return "dev servers stopped";
      }),
      step(
        "Remove the portless aliases",
        async () => {
          await releaseAliases(Object.values(slot!.ports));
          return "aliases removed";
        },
        slot !== null
      ),
      step(
        "Flush the redis keys",
        async () => {
          await flushDb(slot!.redisDb);
          return `redis db ${slot!.redisDb} flushed`;
        },
        volumes && slot !== null
      ),
      step(
        "Release the slot",
        async () => {
          removeSlot(stack.slug);
          return "slot released";
        },
        purge
      )
    ],
    { plain: opts.plain }
  );
  return failures;
}
