// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { REGISTRY_HELPERS_DIR } from "@carbon/database/authz-registry-sql";
import type { Violation } from "../check";

export const REGISTRY_HELPERS_FRESH = "registry-helpers-fresh";

export const REGISTRY_HELPERS_FIX = "pnpm --filter @carbon/database authz sync";

/**
 * The managed helpers whose bodies are the registry (every file
 * `renderRegistryHelpers()` renders) are written from `access/pages` by
 * `authz sync`. A page edit without a sync leaves the database answering from
 * the old registry.
 *
 * `rendered` is what each file must hold (`renderRegistryHelpers()` in
 * `@carbon/database/authz-registry-sql`); `files` is what the repo holds, a
 * missing file passed as `undefined` contents. Each file that differs fails.
 */
export function findStaleRegistryHelpers(
  rendered: readonly { name: string; sql: string }[],
  files: readonly { file: string; contents: string | undefined }[]
): Violation[] {
  const byFile = new Map(files.map((f) => [f.file, f.contents]));
  const violations: Violation[] = [];
  for (const { name, sql } of rendered) {
    const file = `${REGISTRY_HELPERS_DIR}/${name}`;
    const contents = byFile.get(file);
    if (contents === sql) continue;
    violations.push({
      file,
      line: 0,
      snippet: name,
      message:
        contents === undefined
          ? `${name} is missing: run ${REGISTRY_HELPERS_FIX}`
          : `${name} is stale (it differs from the registry): run ${REGISTRY_HELPERS_FIX}`
    });
  }
  return violations;
}
