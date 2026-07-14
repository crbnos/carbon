import { cancel, intro, log } from "@clack/prompts";
import { confirmReset } from "../prompts.js";
import {
  destroyProject,
  ensureDockerRunning,
  flushDb,
  listCarbonProjects,
  REDIS_CONTAINER
} from "../services/compose.js";
import {
  getSlot,
  getWorktreeRoot,
  listSlugs,
  projectName,
  resolveSlug
} from "../worktree.js";
import { up } from "./up.js";

export async function reset() {
  intro("Carbon · dev reset");
  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  const project = projectName(slug);

  // Fail fast with an actionable message instead of a silent partial reset.
  await ensureDockerRunning();

  // No ensureSlugAvailable guard — the user confirmed via confirmReset below.
  // The guard (meant for `up`) would block resetting moved/borrowed/stale
  // worktrees, leaving volumes intact and defeating the purpose of `reset`.

  if (!(await confirmReset(project))) {
    cancel("reset aborted");
    process.exit(0);
  }

  log.warn(`resetting ${project}`);

  // Use destroyProject directly (not stopStack) — it doesn't depend on the
  // compose file or .env.local, finds containers/networks/volumes by project
  // label, and force-removes them. stopStack tries compose first (which can
  // fail silently when .env.local is missing) then falls back to this anyway.
  await destroyProject(project, true);

  const slot = getSlot(slug);
  if (slot && typeof slot.redisDb === "number") {
    await flushDb(slot.redisDb);
  }

  // Clean up orphan docker projects from deleted worktrees.
  const knownProjects = new Set(
    Object.keys(listSlugs()).map((s) => projectName(s))
  );
  // The current project is known — it was already cleaned above.
  knownProjects.add(projectName(slug));

  const allProjects = await listCarbonProjects();
  const orphans = allProjects.filter(
    (p) => !knownProjects.has(p) && p !== REDIS_CONTAINER
  );
  if (orphans.length > 0) {
    log.warn(
      `cleaning ${orphans.length} orphan project(s): ${orphans.join(", ")}`
    );
    await Promise.all(orphans.map((p) => destroyProject(p)));
  }

  await up();
}
