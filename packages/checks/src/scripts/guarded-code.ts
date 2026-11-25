// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Warn when a branch changes race-protected code (`guarded-code.json`).
 *
 *   pnpm --filter @carbon/checks guarded-code [base] [--root <repo>]
 *
 * Diffs `<base>...HEAD` (default `origin/main`) in the repo at `--root`
 * (default: this checkout), and prints one GitHub Actions `::warning` per
 * guarded function the diff touches. Always exits 0: it tells the author
 * which database tests to keep passing, it does not block the change.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  annotation,
  parseDiff,
  parseRegistry,
  touchedGuards
} from "../guarded-code";
import { repoRoot } from "../sources/migrations";

const REGISTRY = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../guarded-code.json"
);

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function show(root: string, ref: string, file: string): string | null {
  try {
    return git(root, ["show", `${ref}:${file}`]);
  } catch {
    return null;
  }
}

/**
 * The commit `<base>...HEAD` diffs against: their merge base. A shallow CI
 * checkout of a pull request has none — its HEAD is GitHub's merge commit
 * with no history — but that commit's first parent is the base tip it merged
 * into, so the diff against that parent is exactly the pull request's change.
 * Failing both, `<base>` itself.
 */
function diffBase(root: string, base: string): string | null {
  try {
    return git(root, ["merge-base", base, "HEAD"]).trim();
  } catch {
    // Parent lines are in the commit object even when the parents are not.
    const parents = [
      ...git(root, ["cat-file", "-p", "HEAD"]).matchAll(/^parent (\w+)$/gm)
    ].map((m) => m[1] as string);
    const first = parents[0];
    if (parents.length > 1 && first) {
      try {
        git(root, ["cat-file", "-e", `${first}^{commit}`]);
        console.error(
          `guarded-code: no merge base with ${base} (shallow clone); diffing the merge commit against its first parent`
        );
        return first;
      } catch {
        // The base tip was not fetched; fall through.
      }
    }
    try {
      const tip = git(root, ["rev-parse", "--verify", `${base}^{commit}`]);
      console.error(
        `guarded-code: no merge base with ${base} (shallow clone); diffing against ${base} itself`
      );
      return tip.trim();
    } catch {
      return null;
    }
  }
}

function parseArgs(argv: string[]): { base: string; root: string } {
  let base = "origin/main";
  let root = repoRoot();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--root") root = resolve(argv[++i] ?? ".");
    else if (arg.startsWith("--root=")) root = resolve(arg.slice(7));
    else if (arg !== "--") base = arg;
  }
  return { base, root };
}

function main() {
  const { base, root } = parseArgs(process.argv.slice(2));
  const registry = parseRegistry(readFileSync(REGISTRY, "utf8"));
  const files = [...new Set(registry.map((e) => e.file))];

  const from = diffBase(root, base);
  if (!from) {
    console.error(
      `guarded-code: cannot resolve ${base}; fetch it first (git fetch origin main). Nothing checked.`
    );
    return;
  }

  const diff = parseDiff(
    git(root, ["diff", "-U0", "--no-color", from, "HEAD", "--", ...files])
  );
  // Several entries share a file, and these files run to 30 000 lines.
  const sources = new Map<string, [string | null, string | null]>();
  const sourcesOf = (file: string) => {
    let pair = sources.get(file);
    if (!pair) {
      pair = [show(root, "HEAD", file), show(root, from, file)];
      sources.set(file, pair);
    }
    return pair;
  };
  for (const entry of registry) {
    const hunks = diff.get(entry.file);
    if (!hunks || hunks.length === 0) continue;
    const [newSource, oldSource] = sourcesOf(entry.file);
    const touches = touchedGuards(entry, hunks, newSource, oldSource);
    for (const touch of touches) console.log(annotation(touch));
  }
}

try {
  main();
} catch (error) {
  // A warning tool never fails the job; say why it checked nothing.
  console.error(
    `guarded-code: ${error instanceof Error ? error.message : String(error)}`
  );
}
