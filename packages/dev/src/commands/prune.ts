// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync } from "node:fs";
import { cancel, intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import { confirmPrune } from "../prompts.js";
import {
  destroyProject,
  ensureDockerRunning,
  flushDb,
  listCarbonStacks
} from "../services/compose.js";
import {
  findStaleAliases,
  pruneStaleRoutes,
  removeAliases
} from "../services/portless.js";
import { listSlugs, projectName, removeSlot } from "../worktree.js";

type Slots = Record<string, { worktreeRoot: string }>;

// A stack is prunable when nothing can reach it any more: its slot points at a
// directory that is gone (worktree deleted without `crbn remove`), or it has no
// slot at all. Slots are compared by directory, not `git worktree list` — the
// registry is machine-wide and holds other clones too. `all` takes every stack
// instead; live worktrees keep their slot and rebuild on the next `crbn up`.
export function planPrune(
  slots: Slots,
  stackProjects: string[],
  opts: { all?: boolean; exists?: (path: string) => boolean } = {}
): { deadSlugs: string[]; projects: string[] } {
  const exists = opts.exists ?? existsSync;
  const deadSlugs = Object.keys(slots).filter(
    (slug) => !exists(slots[slug]!.worktreeRoot)
  );
  const dead = new Set(deadSlugs);
  const live = new Set(
    Object.keys(slots)
      .filter((slug) => !dead.has(slug))
      .map(projectName)
  );
  const projects = new Set([
    ...deadSlugs.map(projectName),
    ...stackProjects.filter((p) => opts.all || !live.has(p))
  ]);
  return { deadSlugs, projects: [...projects].sort() };
}

export async function prune(opts: { all?: boolean } = {}) {
  intro(opts.all ? "Carbon · prune --all" : "Carbon · prune");
  await ensureDockerRunning();

  const slots = listSlugs();
  const { deadSlugs, projects } = planPrune(slots, await listCarbonStacks(), {
    all: opts.all
  });
  // Ports of the slots that survive this prune; every other crbn route is dead.
  const dead = new Set(deadSlugs);
  const livePorts = new Set(
    Object.entries(slots)
      .filter(([slug]) => !dead.has(slug))
      .flatMap(([, slot]) => Object.values(slot.ports))
  );
  const routes = findStaleAliases(livePorts);

  if (projects.length === 0) {
    if (routes.length === 0) {
      outro("nothing to prune");
      return;
    }
    // Routes are not data: the next `crbn up` registers its own again.
    await removeAliases(routes);
    outro(`removed ${routes.length} stale portless route(s)`);
    return;
  }

  const reasons = new Map(
    Object.keys(slots).map((slug) => [
      projectName(slug),
      dead.has(slug)
        ? `${slots[slug]!.worktreeRoot} is gone`
        : slots[slug]!.worktreeRoot
    ])
  );
  log.warn(
    projects
      .map((p) => `${pc.bold(p)}  ${pc.dim(reasons.get(p) ?? "no slot")}`)
      .join("\n")
  );

  if (!(await confirmPrune(projects.length))) {
    cancel("prune aborted");
    process.exit(0);
  }

  await Promise.all(projects.map((p) => destroyProject(p)));
  for (const slug of Object.keys(slots)) {
    if (!dead.has(slug) && !opts.all) continue;
    await flushDb(slots[slug]!.redisDb);
    if (dead.has(slug)) removeSlot(slug);
  }
  await pruneStaleRoutes();
  await removeAliases(routes);

  outro(
    `removed ${projects.length} stack(s), released ${deadSlugs.length} slot(s), cleared ${routes.length} stale portless route(s)`
  );
}
