import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sq } from "./shell";
import type { Shell } from "./types";

/**
 * Create the loop's isolated worktree off `origin/main` and return its absolute
 * path. `crbn new` writes the path to the file named by `$CRBN_NEW_TARGET`
 * (its shell wrapper uses this to `cd`), so we point it at a temp file and read.
 *
 * Note: this depends on `crbn` being invocable as a plain command on the box's
 * PATH. If `crbn` is only a shell function in an interactive profile, run the
 * loop with an explicit `--cwd` worktree you created instead (milestone 1).
 */
export function createWorktree(id: string, shell: Shell): string {
  const fetch = shell("git fetch origin main");
  if (!fetch.ok) throw new Error(`git fetch failed: ${fetch.output}`);

  const target = join(mkdtempSync(join(tmpdir(), "crbn-")), "target");
  const r = shell(
    `CRBN_NEW_TARGET=${sq(target)} crbn new loop/${id} --base origin/main --yes`
  );
  if (!r.ok) throw new Error(`crbn new failed: ${r.output}`);
  try {
    return readFileSync(target, "utf8").trim();
  } catch {
    throw new Error(`crbn new did not write a worktree path: ${r.output}`);
  }
}

/**
 * Remove the local worktree after the PR is pushed. Uses raw git (not the
 * interactive `crbn remove`); the remote branch stays alive for the open PR.
 */
export function removeWorktree(path: string, shell: Shell): void {
  shell(`git worktree remove --force ${sq(path)}`);
}
