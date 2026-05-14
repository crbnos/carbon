import { intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import { listWorktrees as gitListWorktrees } from "../git.js";
import { dockerProjectStates } from "../services/compose.js";
import { worktreesTable } from "../ui.js";
import { listSlugs } from "../worktree.js";

export async function listWorktrees() {
  intro("Carbon · worktrees");

  const [wtsAll, registry, dockerStates] = await Promise.all([
    gitListWorktrees(),
    Promise.resolve(listSlugs()),
    dockerProjectStates()
  ]);
  const wts = wtsAll.filter((w) => !w.bare);

  const rows = wts.map((w) => {
    const slug = slugForPath(w.path, registry);
    const dockerState = slug
      ? (dockerStates.get(`carbon-${slug}`) ?? null)
      : null;
    return {
      path: w.path,
      branch: w.branch,
      current: w.current,
      slug,
      dockerState
    };
  });

  log.message("\n" + worktreesTable(rows), {
    symbol: pc.bold(pc.yellow("worktrees"))
  });
  outro("");
}

function slugForPath(
  path: string,
  registry: ReturnType<typeof listSlugs>
): string | null {
  for (const [slug, entry] of Object.entries(registry)) {
    if (entry.worktreeRoot === path) return slug;
  }
  return null;
}
