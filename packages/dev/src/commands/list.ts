import { intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import { listWorktrees as gitListWorktrees } from "../git.js";
import { dockerProjectStates } from "../services/compose.js";
import { worktreesTable } from "../ui.js";
import { listSlugs, projectName, slugForWorktreePath } from "../worktree.js";

export async function listWorktrees() {
  intro("Carbon · worktrees");

  const [wtsAll, registry, dockerStates] = await Promise.all([
    gitListWorktrees(),
    Promise.resolve(listSlugs()),
    dockerProjectStates()
  ]);
  const wts = wtsAll.filter((w) => !w.bare);

  const rows = wts.map((w) => {
    const slug = slugForWorktreePath(w.path, registry);
    const dockerState = slug
      ? (dockerStates.get(projectName(slug)) ?? null)
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
