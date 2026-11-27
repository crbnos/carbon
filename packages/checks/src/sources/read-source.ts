// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../check";

// The TypeScript loaders walk overlapping folders, so each file is read once
// per process. A file changed after its first read is not seen again.
const kept = new Map<string, string>();

/** The UTF-8 text of the file at `absolutePath`, read at most once. */
export function readSource(absolutePath: string): string {
  let contents = kept.get(absolutePath);
  if (contents === undefined) {
    contents = readFileSync(absolutePath, "utf8");
    kept.set(absolutePath, contents);
  }
  return contents;
}

/**
 * The text `readSource` already holds for `absolutePath`, else the file read
 * now and not kept, so a caller that reads a file again sees its changes.
 */
export function readSourceWithoutKeeping(absolutePath: string): string {
  return kept.get(absolutePath) ?? readFileSync(absolutePath, "utf8");
}

/** The repo-relative `file`, read now. */
export const read = (root: string, file: string): SourceFile => ({
  file,
  contents: readFileSync(join(root, file), "utf8")
});

/** Each of the repo-relative `files` that exists, read now. */
export const readIfPresent = (root: string, files: string[]): SourceFile[] =>
  files
    .filter((file) => existsSync(join(root, file)))
    .map((f) => read(root, f));
