// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../check";

// Readers for the files the cross-file checks compare, so each check stays a
// pure function of its inputs.

export const read = (root: string, file: string): SourceFile => ({
  file,
  contents: readFileSync(join(root, file), "utf8")
});

export const readIfPresent = (root: string, files: string[]): SourceFile[] =>
  files
    .filter((file) => existsSync(join(root, file)))
    .map((f) => read(root, f));

/** Each integration descriptor: `packages/ee/src/<id>/config.ts(x)`. */
export function loadIntegrationConfigs(root: string): SourceFile[] {
  const dir = "packages/ee/src";
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap(({ name }) =>
      readIfPresent(root, [
        `${dir}/${name}/config.tsx`,
        `${dir}/${name}/config.ts`
      ])
    );
}
