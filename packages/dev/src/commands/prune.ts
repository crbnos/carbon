// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync } from "node:fs";
import { cancel, intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import {
  listWorktrees as gitListWorktrees,
  isDirty,
  mainCheckoutRoot,
  pruneWorktreeEntries,
  removeCleanWorktree,
  type Worktree
} from "../git.js";
import { confirmPrune } from "../prompts.js";
import { killOrphanedApps } from "../services/apps.js";
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
import {
  getWorktreeRoot,
  listSlugs,
  projectName,
  removeSlot,
  sameWorktreePath,
  slugForWorktreePath
} from "../worktree.js";

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

export async function prune(opts: { all?: boolean; tree?: boolean } = {}) {
  intro(opts.all ? "Carbon · prune --all" : "Carbon · prune");
  await ensureDockerRunning();

  // --tree: git's side of the same cleanup. Always forget worktrees whose
  // directory is gone; with --all, also remove the linked worktrees of this
  // repo. Never the main checkout or the one we are in, and never one with
  // uncommitted changes or a detached HEAD — `crbn remove` discards those.
  let trees: Worktree[] = [];
  let dirtyTrees: Worktree[] = [];
  if (opts.tree) {
    if (opts.all) {
      const mainRoot = await mainCheckoutRoot();
      const here = await getWorktreeRoot();
      const linked = (await gitListWorktrees()).filter(
        (w) =>
          !w.bare &&
          !sameWorktreePath(w.path, here) &&
          !sameWorktreePath(w.path, mainRoot)
      );
      // A detached worktree's commits are on no branch; removing it would
      // leave them unreachable, so it counts as unsaved work.
      const unsaved = await Promise.all(
        linked.map(async (w) => !w.branch || (await isDirty(w.path)))
      );
      trees = linked.filter((_, i) => !unsaved[i]);
      dirtyTrees = linked.filter((_, i) => unsaved[i]);
    }
  }
  // Runs with the rest of the cleanup, never before the confirmation.
  const forgetMissingTrees = async () => {
    if (opts.tree) await pruneWorktreeEntries();
  };

  const slots = listSlugs();
  const { deadSlugs, projects } = planPrune(slots, await listCarbonStacks(), {
    all: opts.all
  });
  // Routes whose port no surviving slot owns. `gone` adds the slots of
  // worktrees this run actually removed — not the ones it only meant to.
  const dead = new Set(deadSlugs);
  const staleRoutes = (gone = new Set<string>()) =>
    findStaleAliases(
      new Set(
        Object.entries(slots)
          .filter(([slug]) => !dead.has(slug) && !gone.has(slug))
          .flatMap(([, slot]) => Object.values(slot.ports))
      )
    );
  const routes = staleRoutes();

  if (projects.length === 0 && trees.length === 0) {
    await forgetMissingTrees();
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
  if (projects.length > 0) {
    log.warn(
      projects
        .map((p) => `${pc.bold(p)}  ${pc.dim(reasons.get(p) ?? "no slot")}`)
        .join("\n")
    );
  }

  if (trees.length > 0) {
    log.warn(
      `worktrees to remove (branches are kept):\n${trees.map((w) => `${pc.bold(w.branch ?? "(detached)")}  ${pc.dim(w.path)}`).join("\n")}`
    );
  }
  if (dirtyTrees.length > 0) {
    log.info(
      `kept (uncommitted changes or detached HEAD):\n${dirtyTrees.map((w) => `${w.branch ?? "(detached)"}  ${pc.dim(w.path)}`).join("\n")}`
    );
  }

  if (!(await confirmPrune(projects.length, trees.length))) {
    cancel("prune aborted");
    process.exit(0);
  }

  await Promise.all(projects.map((p) => destroyProject(p)));
  for (const slug of Object.keys(slots)) {
    if (!dead.has(slug) && !opts.all) continue;
    await flushDb(slots[slug]!.redisDb);
    if (dead.has(slug)) removeSlot(slug);
  }
  await forgetMissingTrees();
  let removedTrees = 0;
  const removedSlugs = new Set<string>();
  for (const tree of trees) {
    // Checked again, and removed only by git itself: a file saved while the
    // prompt was open makes the tree dirty, and it must then be kept.
    if (await isDirty(tree.path)) {
      log.info(`kept ${tree.path}: it changed while confirming`);
      continue;
    }
    if (!(await removeCleanWorktree(tree.path))) {
      log.info(`kept ${tree.path}: git would not remove it`);
      continue;
    }
    removedTrees++;
    // Only once the tree is really gone: a kept worktree keeps its dev
    // servers, its slot and its routes.
    const slug = slugForWorktreePath(tree.path, slots);
    if (!slug) continue;
    await killOrphanedApps(slots[slug]!.ports);
    removeSlot(slug);
    removedSlugs.add(slug);
  }
  await pruneStaleRoutes();
  const cleared = staleRoutes(removedSlugs);
  await removeAliases(cleared);

  outro(
    `removed ${projects.length} stack(s) and ${removedTrees} worktree(s), released ${deadSlugs.length} slot(s), cleared ${cleared.length} stale portless route(s)`
  );
}
