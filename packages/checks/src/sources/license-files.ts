// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../check";
import {
  classifyPath,
  isLicenseCandidate,
  LICENSE_ROOTS
} from "../license-headers";

/**
 * Every git-tracked file that may need a license header: in a LICENSE_ROOT (or
 * at the repo root) with an in-scope extension, repo-relative and sorted.
 * Tracked only, so node_modules, build output and gitignored generated files
 * never appear. `--cached` includes a new file once it is staged; a tracked
 * file deleted from the working tree is skipped.
 *
 * The check and the fixer both call this, so they walk the same files.
 */
export function listLicenseCandidates(root: string): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "-z", "--", ...LICENSE_ROOTS, ":(glob)*"],
    { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );
  return out
    .split("\0")
    .filter((path) => path.length > 0 && isLicenseCandidate(path))
    .filter((path) => existsSync(join(root, path)))
    .sort();
}

/**
 * The candidates as SourceFiles, minus the ones excluded by PATH alone — those
 * are never read (the generated DB types alone are several MB). Content-based
 * exclusions are decided by the check itself.
 */
export function loadLicenseFiles(
  root: string,
  paths: string[] = listLicenseCandidates(root)
): SourceFile[] {
  return paths
    .filter((path) => !("excluded" in classifyPath(path)))
    .map((path) => ({
      file: path,
      contents: readFileSync(join(root, path), "utf8")
    }));
}
