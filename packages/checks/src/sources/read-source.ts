// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";

// The TypeScript loaders walk overlapping folders, so each file is read once
// per process. A file changed after its first read is not seen again.
const read = new Map<string, string>();

/** The UTF-8 text of the file at `absolutePath`, read at most once. */
export function readSource(absolutePath: string): string {
  let contents = read.get(absolutePath);
  if (contents === undefined) {
    contents = readFileSync(absolutePath, "utf8");
    read.set(absolutePath, contents);
  }
  return contents;
}

/**
 * The text `readSource` already holds for `absolutePath`, else the file read
 * now and not kept, so a caller that reads a file again sees its changes.
 */
export function readSourceWithoutKeeping(absolutePath: string): string {
  return read.get(absolutePath) ?? readFileSync(absolutePath, "utf8");
}
