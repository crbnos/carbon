import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { execa } from "execa";
import { dirname, resolve } from "pathe";

export type Worktree = {
  path: string;
  branch: string | null; // null = detached
  head: string;
  bare: boolean;
  current: boolean;
};

// Main checkout root — `--git-common-dir`'s parent. Works from any worktree.
export async function mainCheckoutRoot(
  cwd: string = process.cwd()
): Promise<string> {
  const r = await execa("git", ["rev-parse", "--git-common-dir"], {
    cwd,
    reject: false
  });
  if (r.exitCode !== 0) {
    throw new Error("not inside a git repository");
  }
  return dirname(resolve(cwd, r.stdout.trim()));
}

export async function isLinkedWorktree(cwd = process.cwd()): Promise<boolean> {
  // Linked when --git-dir differs from --git-common-dir. Resolve both first —
  // --absolute-git-dir would compare absolute vs relative and false-positive.
  const [a, b] = await Promise.all([
    execa("git", ["rev-parse", "--git-dir"], { cwd, reject: false }),
    execa("git", ["rev-parse", "--git-common-dir"], { cwd, reject: false })
  ]);
  if (a.exitCode !== 0 || b.exitCode !== 0) return false;
  return resolve(cwd, a.stdout.trim()) !== resolve(cwd, b.stdout.trim());
}

export async function currentBranch(cwd = process.cwd()): Promise<string> {
  try {
    const r = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd
    });
    const out = r.stdout.trim();
    return out === "HEAD" ? "" : out;
  } catch {
    return "";
  }
}

export async function listWorktrees(): Promise<Worktree[]> {
  const r = await execa("git", ["worktree", "list", "--porcelain"]);
  const cwd = process.cwd();
  const blocks = r.stdout.trim().split("\n\n");
  return blocks.map((block) => {
    const lines = block.split("\n");
    const get = (key: string) =>
      lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1) ?? "";
    const path = get("worktree");
    const branchLine = lines.find((l) => l.startsWith("branch "));
    const branch = branchLine
      ? branchLine.slice("branch refs/heads/".length)
      : null;
    return {
      path,
      branch,
      head: get("HEAD"),
      bare: lines.includes("bare"),
      current: path === cwd
    };
  });
}

export async function addWorktree(opts: {
  path: string;
  branch: string;
  baseRef: string;
}): Promise<void> {
  const r = await execa(
    "git",
    ["worktree", "add", "-b", opts.branch, opts.path, opts.baseRef],
    { reject: false }
  );
  if (r.exitCode !== 0) {
    throw new Error((r.stderr || r.stdout || "git worktree add failed").trim());
  }
}

export async function removeWorktree(
  path: string,
  force = false
): Promise<void> {
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(path);
  const r = await execa("git", args, { reject: false });
  if (r.exitCode === 0) return;

  // git refused (busy dir from a held cwd, locked, or corrupt gitdir). The
  // caller already confirmed removal — fall back to a direct directory wipe
  // and prune the orphaned admin metadata so git's worktree list stays clean.
  if (existsSync(path)) {
    await rm(path, { recursive: true, force: true });
  }
  await execa("git", ["worktree", "prune"], { reject: false });
}

export async function isDirty(path: string): Promise<boolean> {
  const r = await execa("git", ["status", "--porcelain"], {
    cwd: path,
    reject: false
  });
  return r.exitCode === 0 && (r.stdout || "").trim().length > 0;
}

export async function branchExists(branch: string): Promise<boolean> {
  const r = await execa(
    "git",
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { reject: false }
  );
  return r.exitCode === 0;
}

/**
 * Check if creating `branch` would conflict with an existing ref in the
 * hierarchy. Git refs are path-like: `test` and `test/sid` can't coexist
 * because `test` would need to be both a file and a directory under
 * `.git/refs/heads/`.
 *
 * Returns the conflicting ref name, or null if no conflict.
 */
export async function refConflict(branch: string): Promise<string | null> {
  // A parent segment exists as a branch? e.g. "test" blocks "test/sid".
  const parts = branch.split("/");
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join("/");
    if (await branchExists(ancestor)) return ancestor;
  }
  // A child branch exists under this name? e.g. "test/sid" blocks "test".
  const r = await execa(
    "git",
    ["for-each-ref", "--format=%(refname:short)", `refs/heads/${branch}/`],
    { reject: false }
  );
  if (r.exitCode === 0 && r.stdout.trim()) {
    return r.stdout.trim().split("\n")[0]!;
  }
  return null;
}

export async function deleteBranch(branch: string): Promise<void> {
  // -D forces even on unmerged; caller confirms.
  const r = await execa("git", ["branch", "-D", branch], { reject: false });
  if (r.exitCode !== 0) {
    throw new Error(
      (r.stderr || r.stdout || `git branch -D ${branch} failed`).trim()
    );
  }
}
