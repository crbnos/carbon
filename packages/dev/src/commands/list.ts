// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import { listWorktrees as gitListWorktrees } from "../git.js";
import { dockerProjectStates } from "../services/compose.js";
import { isAsleep } from "../services/hibernate.js";
import { stackAt } from "../stack.js";
import { projectName } from "../topology.js";
import { worktreesTable } from "../ui.js";
import { listSlugs, slugForWorktreePath } from "../worktree.js";

export async function listWorktrees(opts: { json?: boolean } = {}) {
  if (!opts.json) intro("Carbon · worktrees");

  const [wtsAll, registry, dockerStates] = await Promise.all([
    gitListWorktrees(),
    listSlugs(),
    dockerProjectStates()
  ]);
  const wts = wtsAll.filter((w) => !w.bare);

  const rows = wts.map((w) => {
    const slug = slugForWorktreePath(w.path, registry);
    const dockerState = !slug
      ? null
      : isAsleep(slug)
        ? "hibernated"
        : (dockerStates.get(projectName(slug)) ?? null);
    const stack = slug ? stackAt(w.path, slug) : null;
    const mode = stack?.recordedMode ?? null;
    return {
      path: w.path,
      branch: w.branch,
      current: w.current,
      slug,
      dockerState,
      mode,
      database: mode ? (stack?.db?.database ?? null) : null
    };
  });

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }

  log.message("\n" + worktreesTable(rows), {
    symbol: pc.bold(pc.yellow("worktrees"))
  });
  outro("");
}
