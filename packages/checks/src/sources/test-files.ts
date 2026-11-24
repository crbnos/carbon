// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../check";
import { SHARED_TEST_FIXTURES_DIR } from "../conformance/no-silent-test-pass";

// packages/checks is left out: it is the one package whose tests read source
// and migration text, by design.
const TEST_PATHSPECS = [
  ...["apps", "packages", "scripts", "docs/content"].flatMap((dir) => [
    `:(glob)${dir}/**/*.test.ts`,
    `:(glob)${dir}/**/*.test.tsx`
  ]),
  ":(exclude)packages/checks/**"
];

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

export function loadSharedTestFixtures(root: string): SourceFile[] {
  return readdirSync(join(root, SHARED_TEST_FIXTURES_DIR))
    .filter((name) => /\.tsx?$/.test(name))
    .sort()
    .map((name) => {
      const file = `${SHARED_TEST_FIXTURES_DIR}/${name}`;
      return { file, contents: readFileSync(join(root, file), "utf8") };
    });
}
