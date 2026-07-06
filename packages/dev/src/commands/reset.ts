import { cancel, intro, log } from "@clack/prompts";
import { confirmReset } from "../prompts.js";
import {
  destroyProject,
  flushDb,
  listCarbonProjects,
  stopStack
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

  if (!(await confirmReset(projectName(slug)))) {
    cancel("reset aborted");
    process.exit(0);
  }

  log.warn(`resetting ${projectName(slug)}`);

  // Tear down current stack (compose-aware, removes containers + volumes).
  await stopStack(root, slug, true);

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
    (p) => !knownProjects.has(p) && p !== "carbon-shared"
  );
  if (orphans.length > 0) {
    log.warn(
      `cleaning ${orphans.length} orphan project(s): ${orphans.join(", ")}`
    );
    await Promise.all(orphans.map((p) => destroyProject(p)));
  }

  await up();
}
