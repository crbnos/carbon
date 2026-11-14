// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { intro, isCancel, log, multiselect, outro } from "@clack/prompts";
import { resolve } from "pathe";
import pc from "picocolors";
import {
  deleteBranch,
  listWorktrees as gitListWorktrees,
  isDirty,
  mainCheckoutRoot,
  removeWorktree
} from "../git.js";
import { abort, confirmDestructive, requireTerminal } from "../prompts.js";
import { stackAt } from "../stack.js";
import { teardown } from "../teardown.js";
import {
  listSlugs,
  sameWorktreePath,
  slugForWorktreePath
} from "../worktree.js";

export async function removeWorktreeCmd(opts?: {
  prune?: boolean;
  /** Branch names or paths; skips the picker. */
  targets?: string[];
}) {
  const pruneBranches = opts?.prune === true;
  intro("Carbon · remove worktree");

  const wtsAll = await gitListWorktrees();
  const mainRoot = await mainCheckoutRoot();
  const wts = wtsAll.filter(
    (w) => !w.bare && !w.current && !sameWorktreePath(w.path, mainRoot)
  );
  if (wts.length === 0) {
    log.warn("no other worktrees to remove");
    outro("");
    return;
  }

  let selectedPaths: string[];
  if (opts?.targets?.length) {
    selectedPaths = opts.targets.map((name) => {
      const match = wts.find(
        (w) => w.branch === name || sameWorktreePath(w.path, resolve(name))
      );
      if (!match) {
        throw new Error(
          `No removable worktree for '${name}' (pass a branch name or a path; \`crbn list\` shows them)`
        );
      }
      return match.path;
    });
  } else {
    requireTerminal(
      "Picking worktrees to remove",
      "Name them instead: `crbn remove <branch-or-path...>`."
    );
    const choices = await multiselect({
      message: "Worktrees to remove",
      options: wts.map((w) => ({
        value: w.path,
        label: `${w.branch ?? "(detached)"}  ${pc.dim(w.path)}`
      })),
      required: true
    });
    if (isCancel(choices)) abort();
    selectedPaths = choices as string[];
  }
  const targets = selectedPaths.map((p) => wts.find((w) => w.path === p)!);

  const registry = listSlugs();
  const jobs = await Promise.all(
    targets.map(async (target) => {
      const slug = slugForWorktreePath(target.path, registry);
      return {
        target,
        label: target.branch ?? target.path,
        dirty: await isDirty(target.path),
        stack: slug ? stackAt(target.path, slug) : null
      };
    })
  );

  for (const { target, label, dirty, stack } of jobs) {
    const warnings: string[] = [];
    if (dirty) {
      warnings.push(
        `${pc.yellow("⚠")} uncommitted changes will be LOST (force remove)`
      );
    }
    if (stack) {
      warnings.push(
        `${pc.yellow("⚠")} stack ${stack.project} will be destroyed (volumes wiped)`
      );
    }
    if (pruneBranches && target.branch) {
      warnings.push(
        `${pc.yellow("⚠")} branch '${target.branch}' will be force-deleted (git branch -D, even if unmerged)`
      );
    }
    if (warnings.length) log.warn(`${label}\n${warnings.join("\n")}`);
    await confirmDestructive(
      "Confirming a removal",
      `Permanently remove ${label} and ${stack ? "wipe its docker volumes" : "the worktree"}?`
    );
  }

  let failed = 0;
  for (const { target, label, stack } of jobs) {
    log.step(label);
    try {
      // First: its dev servers hold the folder open, and `git worktree
      // remove` fails on a busy directory.
      if (stack) {
        const failures = await teardown(stack, { purge: true });
        for (const failure of failures) log.warn(failure);
      }
      await removeWorktree(target.path);
      if (pruneBranches && target.branch) await deleteBranch(target.branch);
    } catch (err) {
      failed++;
      log.error(`${label}: ${(err as Error).message}`);
    }
  }
  outro(failed ? `done with ${failed} error(s)` : "done");
}
