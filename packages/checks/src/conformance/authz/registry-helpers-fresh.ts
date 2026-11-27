// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { REGISTRY_HELPERS_DIR } from "@carbon/database/authz-registry-sql";
import { defineCheck, type Violation } from "../../check";
import { loadRegistryHelpers } from "../../sources/authz-registry";

// The managed helpers whose bodies are the registry (every file
// `renderRegistryHelpers()` renders) are written from `access/pages` by
// `authz sync`. A page edit without a sync leaves the database answering from
// the old registry.
//
// `rendered` is what each file must hold (`renderRegistryHelpers()` in
// `@carbon/database/authz-registry-sql`); `files` is what the repo holds, a
// missing file passed as `undefined` contents. Each file that differs fails.
export const registryHelpersFresh = defineCheck({
  id: "registry-helpers-fresh",
  description:
    "The managed helpers whose bodies are the registry (every file `renderRegistryHelpers()` renders) are written from `access/pages` by `authz sync`.",
  reads: { helpers: loadRegistryHelpers },
  rule() {
    const fix = "pnpm --filter @carbon/database authz sync";
    return ({ helpers }) => {
      const byFile = new Map(helpers.files.map((f) => [f.file, f.contents]));
      const violations: Violation[] = [];
      for (const { name, sql } of helpers.rendered) {
        const file = `${REGISTRY_HELPERS_DIR}/${name}`;
        const contents = byFile.get(file);
        if (contents === sql) continue;
        violations.push({
          file,
          line: 0,
          snippet: name,
          message:
            contents === undefined
              ? `${name} is missing: run ${fix}`
              : `${name} is stale (it differs from the registry): run ${fix}`
        });
      }
      return violations;
    };
  }
});
