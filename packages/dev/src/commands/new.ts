// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, writeFileSync } from "node:fs";
import {
  confirm,
  intro,
  isCancel,
  log,
  outro,
  select,
  text
} from "@clack/prompts";
import { dirname, join, relative, resolve } from "pathe";
import pc from "picocolors";
import {
  addWorktree,
  branchExists,
  currentBranch,
  deleteBranch,
  getWorktreeRoot,
  isValidBranchName,
  listWorktrees,
  mainCheckoutRoot,
  refConflict
} from "../git.js";
import { abort, requireTerminal } from "../prompts.js";
import { tasks } from "../ui.js";
import { worktreeDirName } from "../worktree.js";
import { initWorktree } from "./init.js";

export async function newWorktree(opts?: {
  branch?: string;
  base?: string;
  dir?: string;
  copyEnv?: boolean;
  yes?: boolean;
}) {
  intro("Carbon · new worktree");

  const here = await getWorktreeRoot();
  const mainRoot = await mainCheckoutRoot(here);
  const parentDir = dirname(mainRoot);

  // Non-interactive (`--yes`): skip every prompt, use flags/defaults.
  // Base defaults to origin/main so loops always branch off latest main.
  const nonInteractive = opts?.yes === true;
  if (!nonInteractive) {
    requireTerminal(
      "crbn new",
      "Pass --yes with a branch name to run without one."
    );
  }

  const branch = nonInteractive
    ? opts?.branch
    : await promptBranch(opts?.branch);
  if (!branch) {
    throw new Error("crbn new --yes requires a branch name");
  }

  const defaultDir = worktreeDirName(mainRoot, branch);
  const dirName = nonInteractive
    ? (opts?.dir ?? defaultDir)
    : await promptDirName(parentDir, defaultDir);
  const targetPath = resolve(parentDir, dirName);

  const cur = await currentBranch(here);
  const baseRef = nonInteractive
    ? (opts?.base ?? "origin/main")
    : await promptBaseRef(cur || null);

  const copyEnv = nonInteractive
    ? (opts?.copyEnv ?? true)
    : await promptCopyEnv();

  await tasks([
    {
      title: `git worktree add ${dirName}`,
      task: async (msg) => {
        msg(`branching from ${baseRef}`);
        await addWorktree({ path: targetPath, branch, baseRef });
        return `worktree at ${relative(here, targetPath)}`;
      }
    },
    {
      title: "Provision worktree",
      task: async (msg) => {
        msg("slug + env sync + skills");
        await initWorktree({ root: targetPath, copyEnv, quiet: true });
        return copyEnv
          ? "slug set, .env synced, skills linked"
          : "slug set, skills linked";
      }
    }
  ]);

  // setup.sh's `crbn()` shell function cds into the path written here: the
  // prompts own stdout, so it can't be read from there.
  const targetFile = process.env.CRBN_NEW_TARGET;
  if (targetFile) writeFileSync(targetFile, targetPath);

  outro(`worktree ready — ${pc.cyan("crbn up")} to boot it`);
}

async function promptBranch(initial?: string): Promise<string> {
  while (true) {
    const value = await text({
      message: "Branch name",
      placeholder: "feature/foo",
      initialValue: initial,
      validate(v) {
        if (!v || !v.trim()) return "Branch is required";
        if (v.trim().length > 100) return "Branch name too long";
      }
    });
    if (isCancel(value)) abort();
    const trimmed = (value as string).trim();
    if (!(await isValidBranchName(trimmed))) {
      log.error(`'${trimmed}' is not a valid git branch name`);
      initial = trimmed;
      continue;
    }
    // Git refs are paths: a branch "test" blocks "test/sid", and the reverse.
    const conflict = await refConflict(trimmed);
    if (conflict) {
      log.error(
        `Branch '${trimmed}' conflicts with existing ref '${conflict}'.\n` +
          `  Git can't have both — pick a different name or delete '${conflict}' first.`
      );
      initial = undefined;
      continue;
    }
    if (await branchExists(trimmed)) {
      const worktrees = await listWorktrees();
      const onWorktree = worktrees.find((w) => w.branch === trimmed);
      if (onWorktree) {
        log.error(
          `Branch '${trimmed}' already has a worktree at ${pc.dim(onWorktree.path)}\n` +
            `  Jump in with:  ${pc.cyan(`crbn checkout ${trimmed}`)}`
        );
        continue;
      }
      log.warn(
        `Branch '${trimmed}' exists locally but has no worktree.\n` +
          `  Materialize the existing branch with:  ${pc.cyan(`crbn checkout ${trimmed}`)}`
      );
      const recreate = await confirm({
        message: `Delete '${trimmed}' (force — discards any unmerged commits) and create fresh branch?`,
        initialValue: false
      });
      if (isCancel(recreate)) abort();
      if (!recreate) continue;
      try {
        await deleteBranch(trimmed);
      } catch (err) {
        log.error(`Failed to delete branch: ${(err as Error).message}`);
        continue;
      }
      log.success(`Deleted branch '${trimmed}'`);
    }
    return trimmed;
  }
}

async function promptDirName(
  parentDir: string,
  initial: string
): Promise<string> {
  while (true) {
    const value = await text({
      message: `Worktree directory (relative to ${pc.dim(parentDir)})`,
      initialValue: initial,
      validate(v) {
        if (!v || !v.trim()) return "Directory name required";
        if (/[\s/]/.test(v.trim()))
          return "No spaces or slashes — must be a single dirname";
      }
    });
    if (isCancel(value)) abort();
    const trimmed = (value as string).trim();
    if (existsSync(join(parentDir, trimmed))) {
      log.error(`Path '${trimmed}' already exists in ${parentDir}`);
      continue;
    }
    return trimmed;
  }
}

async function promptBaseRef(currentBranch: string | null): Promise<string> {
  const opts: { value: string; label: string }[] = [
    { value: "main", label: "main" }
  ];
  if (currentBranch && currentBranch !== "main") {
    opts.push({ value: currentBranch, label: currentBranch });
  }
  opts.push({ value: "origin/main", label: "origin/main" });

  const baseRef = await select({
    message: "Base ref",
    options: opts,
    initialValue: "main"
  });
  if (isCancel(baseRef)) abort();
  return baseRef as string;
}

async function promptCopyEnv(): Promise<boolean> {
  const ok = await confirm({
    message: "Copy .env from the main checkout?",
    initialValue: true
  });
  if (isCancel(ok)) abort();
  return ok as boolean;
}
