// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULES, moduleOf, ownersOf } from "@carbon/database/access";
import { defineCheck } from "../../check";
import { migrations } from "../../sources/inputs";
import {
  type BaseModules,
  findMovedTableGaps,
  type MovedTablesRegistry
} from "../../sources/moved-tables";
import { livePolicies } from "../../sources/rls-policies";

// A table whose page is now in another module than one its policies checked
// before page permissions keeps that module's holders (`findMovedTableGaps`).
export const movedTablesCovered = defineCheck({
  id: "moved-tables-covered",
  description:
    "A table whose page is now in another module than one its policies checked before page permissions keeps that module's holders.",
  reads: { migrations },
  rule() {
    // Per table, the modules whose keys its SELECT (`read`) and its writes
    // (`write`) checked in the manifest on main before page permissions
    // (a0d1fa4279). Frozen: every later move is measured against it, so never
    // regenerate or edit it.
    const base: Readonly<Record<string, BaseModules>> = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../base-table-modules.json"
        ),
        "utf8"
      )
    );
    const registry: MovedTablesRegistry = {
      ownersOf,
      moduleOf,
      hasPages: (module) => MODULES.some((m) => m.id === module)
    };
    return ({ migrations }) =>
      findMovedTableGaps(livePolicies(migrations), registry, base);
  }
});
