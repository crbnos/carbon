// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../check";

// packages/checks is left out: it is the one package whose tests read source
// and migration text, by design.
const TEST_DIRS = ["apps", "packages", "scripts", "docs/content"];

const TEST_PATHSPECS = [
  ...TEST_DIRS.flatMap((dir) => [
    `:(glob)${dir}/**/*.test.ts`,
    `:(glob)${dir}/**/*.test.tsx`
  ]),
  ":(exclude)packages/checks/**"
];

/** The path rule of TEST_PATHSPECS, for one repo-relative path. */
export function isTrackedTestPath(path: string): boolean {
  if (path.startsWith("packages/checks/")) return false;
  if (!(path.endsWith(".test.ts") || path.endsWith(".test.tsx"))) return false;
  return TEST_DIRS.some((dir) => path.startsWith(`${dir}/`));
}

/**
 * Every git-tracked vitest file, repo-relative and sorted. Tracked only, so
 * node_modules and build output never appear; a tracked file deleted from the
 * working tree is skipped.
 */
export function loadTestFiles(root: string): SourceFile[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "-z", "--", ...TEST_PATHSPECS],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  return out
    .split("\0")
    .filter((path) => path.length > 0 && existsSync(join(root, path)))
    .sort()
    .map((path) => ({
      file: path,
      contents: readFileSync(join(root, path), "utf8")
    }));
}
