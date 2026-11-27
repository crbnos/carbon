// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REGISTRY_HELPERS_DIR,
  renderRegistryHelpers
} from "@carbon/database/authz-registry-sql";
import { defineCheck, type Violation } from "../../check";

// The managed helpers whose bodies are the registry (every file
// `renderRegistryHelpers()` renders) are written from `access/pages` by
// `authz sync`. A page edit without a sync leaves the database answering from
// the old registry.
export const registryHelpersFresh = defineCheck({
  id: "registry-helpers-fresh",
  description:
    "The managed helpers whose bodies are the registry (every file `renderRegistryHelpers()` renders) are written from `access/pages` by `authz sync`.",
  reads: {
    helpers: (root: string) => {
      const rendered = renderRegistryHelpers();
      const files = rendered.map(({ name }) => {
        const file = `${REGISTRY_HELPERS_DIR}/${name}`;
        const path = join(root, file);
        return {
          file,
          contents: existsSync(path) ? readFileSync(path, "utf-8") : undefined
        };
      });
      return { rendered, files };
    }
  },
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
