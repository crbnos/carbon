// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Files a worktree takes from the main checkout: package.json#crbn.copy
// (default `.env`), which git does not carry.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "pathe";
import { mainCheckoutRoot } from "./git.js";
import { isAtLeastAsNew } from "./helpers.js";
import { sameWorktreePath } from "./worktree.js";

/** The files package.json#crbn.copy names. */
export function copyList(mainRoot: string): string[] {
  try {
    const pkg = JSON.parse(
      readFileSync(join(mainRoot, "package.json"), "utf8")
    );
    const list = pkg.crbn?.copy;
    if (Array.isArray(list) && list.every((s) => typeof s === "string")) {
      return list;
    }
  } catch {
    // no package.json, or not JSON: the default
  }
  return [".env"];
}

/**
 * Copies `files` (paths relative to the worktree) from the main checkout.
 * `staleOnly` skips a file at least as new as main's. Null in the main
 * checkout itself, where there is nothing to copy from.
 */
export async function copyFromMain(
  root: string,
  files: string[],
  opts: { staleOnly?: boolean } = {}
): Promise<{ copied: string[]; missing: string[] } | null> {
  const mainRoot = await mainCheckoutRoot(root);
  if (sameWorktreePath(mainRoot, root)) return null;
  const copied: string[] = [];
  const missing: string[] = [];
  for (const rel of files) {
    const src = join(mainRoot, rel);
    const dest = join(root, rel);
    if (!existsSync(src)) {
      missing.push(rel);
      continue;
    }
    if (opts.staleOnly && isAtLeastAsNew(dest, src)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    copied.push(rel);
  }
  return { copied, missing };
}

/** Refreshes the copy-files main has newer, so a worktree created before a
 *  new secret landed there gets it. Returns the files copied. */
export async function syncStaleCopyFiles(root: string): Promise<string[]> {
  const mainRoot = await mainCheckoutRoot(root);
  const result = await copyFromMain(root, copyList(mainRoot), {
    staleOnly: true
  });
  return result?.copied ?? [];
}
