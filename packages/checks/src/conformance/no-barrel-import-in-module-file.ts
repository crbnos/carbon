// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

/**
 * A module's own `*.models.ts`, `*.service.ts` and `*.server.ts` files import
 * what they use from the file that defines it, never from a module barrel
 * (`~/modules/sales`, `../accounting`). A barrel re-exports the module's UI,
 * the UI imports other barrels, and the router loads every module's server
 * file: a barrel import closes a cycle, and whichever module loads first reads
 * a constant before it is defined (`z.enum(undefined)` at import). Type-only
 * imports are erased and allowed.
 */
const MODULE_FILE =
  /^apps\/erp\/app\/modules\/[a-z-]+\/[A-Za-z0-9.-]+\.(?:models|service|server)\.tsx?$/;

const BARREL_IMPORT =
  /^import\s+(?!type\s)[^;]*?\sfrom\s+"(~\/modules\/[a-z-]+|\.\.\/[a-z-]+)";/gm;

export const noBarrelImportInModuleFile: ConformanceCheck = {
  id: "no-barrel-import-in-module-file",
  description:
    "A module's models, service and server files import from the defining file, never a module barrel.",
  provenance: {
    deprecates:
      "value imports of a module barrel (`~/modules/<name>`, `../<name>`) from a module's models, service or server file",
    replacedBy:
      "the file that defines the import (`~/modules/<name>/<name>.models`, `.service`, `.server`, `types`)"
  },
  scan(file, contents) {
    if (!MODULE_FILE.test(file)) return [];
    const violations: Violation[] = [];
    for (const match of contents.matchAll(BARREL_IMPORT)) {
      const line = contents.slice(0, match.index).split("\n").length;
      violations.push({
        file,
        line,
        snippet: match[1]!,
        message: `Import from the file that defines it, not the barrel "${match[1]}": a barrel re-exports UI that imports other barrels, and the cycle leaves a constant undefined at import.`
      });
    }
    return violations;
  }
};
