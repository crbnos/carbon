// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync } from "node:fs";
import { intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import {
  getWorktreeRoot,
  listWorktrees as gitListWorktrees,
  isDirty,
  mainCheckoutRoot,
  pruneWorktreeEntries,
  removeCleanWorktree,
  type Worktree
} from "../git.js";
import { tryConnect } from "../helpers.js";
import { confirmDestructive } from "../prompts.js";
import {
  destroyProject,
  ensureDockerRunning,
  listCarbonStacks,
  listVolumes,
  projectsWithService,
  removeVolumes,
  stopSharedServices
} from "../services/compose.js";
import { pruneStaleRoutes, removeStaleAliases } from "../services/portless.js";
import {
  dropWorktreeData,
  listWorktreeDatabases
} from "../services/shared-db.js";
import { stackAt } from "../stack.js";
import { teardown } from "../teardown.js";
import { ISOLATED_VOLUMES, projectName, SHARED_DB_PORT } from "../topology.js";
import {
  listSlugs,
  recordedStackMode,
  removeSlot,
  sameWorktreePath,
  slugForWorktreePath,
  worktreeDatabaseName
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

/**
 * The shared-Postgres side of a prune. `databases`: every wt_ database no
 * live slot owns (with `all`, every wt_ database). `volumes`: the old private
 * volumes of live worktrees now in shared mode, which nothing reads.
 */
export function planSharedPrune(
  live: string[],
  databases: string[],
  volumes: string[],
  opts: { all?: boolean; isShared: (slug: string) => boolean }
): { databases: string[]; volumes: string[] } {
  const owned = new Set(live.map(worktreeDatabaseName));
  const existing = new Set(volumes);
  return {
    databases: databases.filter((d) => opts.all || !owned.has(d)),
    // --all destroys every project with its volumes already.
    volumes: opts.all
      ? []
      : live
          .filter(opts.isShared)
          .flatMap((slug) =>
            ISOLATED_VOLUMES.map((v) => `${projectName(slug)}_${v}`)
          )
          .filter((v) => existing.has(v))
  };
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
  const removeStaleRoutes = (gone = new Set<string>()) =>
    removeStaleAliases(
      new Set(
        Object.entries(slots)
          .filter(([slug]) => !dead.has(slug) && !gone.has(slug))
          .flatMap(([, slot]) => Object.values(slot.ports))
      )
    );

  // Shared Postgres down: no database to list, `prune` drops them next time.
  const databases = (await tryConnect("127.0.0.1", SHARED_DB_PORT, 500))
    ? await listWorktreeDatabases()
    : [];
  // A project with a postgres container runs a private stack now: an older
  // crbn (one that writes no mode) started it after a shared `up`.
  const runsPrivate = new Set(await projectsWithService("postgres"));
  const shared = planSharedPrune(
    Object.keys(slots).filter((slug) => !dead.has(slug)),
    databases,
    await listVolumes(),
    {
      all: opts.all,
      isShared: (slug) =>
        recordedStackMode(slug) === "shared" &&
        !runsPrivate.has(projectName(slug))
    }
  );
  const sharedCount = shared.databases.length + shared.volumes.length;

  if (projects.length === 0 && trees.length === 0 && sharedCount === 0) {
    await forgetMissingTrees();
    if (opts.all) await stopSharedServices();
    // Routes are not data: the next `crbn up` registers its own again.
    const routes = await removeStaleRoutes();
    outro(
      routes.length
        ? `removed ${routes.length} stale portless route(s)`
        : "nothing to prune"
    );
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

  if (sharedCount > 0) {
    log.warn(
      [
        ...shared.databases.map(
          (d) => `${pc.bold(d)}  ${pc.dim("worktree database, no slot")}`
        ),
        ...shared.volumes.map(
          (v) => `${pc.bold(v)}  ${pc.dim("old private volume, now shared")}`
        )
      ].join("\n")
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

  const count = projects.length;
  const message = `${[
    count
      ? `Destroy ${count} stack(s) and their volumes (postgres, storage, inngest data will be wiped)`
      : "",
    sharedCount
      ? `${count ? "drop" : "Drop"} ${sharedCount} worktree database(s) or old volume(s)`
      : "",
    trees.length
      ? `${count || sharedCount ? "remove" : "Remove"} ${trees.length} worktree(s)`
      : ""
  ]
    .filter(Boolean)
    .join(", and ")}?`;
  await confirmDestructive("Confirming a prune", message);

  // A stack with a slot goes through the one teardown: a dead slot's is
  // released, and --all wipes a live one's data but keeps its slot.
  const tornDown = new Set<string>();
  for (const [slug, slot] of Object.entries(slots)) {
    if (!dead.has(slug) && !opts.all) continue;
    tornDown.add(projectName(slug));
    const failures = await teardown(stackAt(slot.worktreeRoot, slug), {
      volumes: true,
      purge: dead.has(slug)
    });
    for (const failure of failures) log.warn(`${slug}: ${failure}`);
  }
  for (const project of projects.filter((p) => !tornDown.has(p))) {
    await destroyProject(project).catch((err: Error) => log.warn(err.message));
  }
  // Storage can be down while Postgres is up: the database then stays, the
  // next prune finds it again, and the rest of this one still runs.
  for (const database of shared.databases) {
    await dropWorktreeData(database).catch((err: Error) =>
      log.warn(`${database}: kept (${err.message})`)
    );
  }
  await removeVolumes(shared.volumes).catch((err: Error) =>
    log.warn(`old volumes kept (${err.message})`)
  );
  if (opts.all) await stopSharedServices();
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
    // Only once the tree is really gone: a kept worktree keeps its slot. Its
    // stack went with the rest of --all's.
    const slug = slugForWorktreePath(tree.path, slots);
    if (!slug) continue;
    removeSlot(slug);
    removedSlugs.add(slug);
  }
  await pruneStaleRoutes();
  const cleared = await removeStaleRoutes(removedSlugs);

  outro(
    `removed ${projects.length} stack(s), ${shared.databases.length} worktree database(s), ${shared.volumes.length} old volume(s) and ${removedTrees} worktree(s), released ${deadSlugs.length} slot(s), cleared ${cleared.length} stale portless route(s)`
  );
}
