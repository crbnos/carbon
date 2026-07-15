import { writeFileSync } from "node:fs";
import { intro, outro, tasks } from "@clack/prompts";
import { basename, dirname, relative, resolve } from "pathe";
import pc from "picocolors";
import { addWorktree, currentBranch } from "../git.js";
import {
  promptBaseRef,
  promptBranch,
  promptCopyEnv,
  promptDirName
} from "../prompts.js";
import { getWorktreeRoot, slugify } from "../worktree.js";
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
  const parentDir = dirname(here);
  const repoBaseName = basename(here).replace(/-[a-z0-9-]+$/i, "");

  // Non-interactive (`--yes`): skip every prompt, use flags/defaults.
  // Base defaults to origin/main so loops always branch off latest main.
  const nonInteractive = opts?.yes === true;

  const branch = nonInteractive
    ? opts?.branch
    : await promptBranch(opts?.branch);
  if (!branch) {
    throw new Error("crbn new --yes requires a branch name");
  }

  const defaultDir = `${repoBaseName}-${slugify(branch)}`;
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

  // Write target path so the shell wrapper can cd into the new worktree.
  const targetFile = process.env.CRBN_NEW_TARGET;
  if (targetFile) {
    writeFileSync(targetFile, targetPath);
  }

  outro(`worktree ready — ${pc.cyan("crbn up")} to boot it`);
}
