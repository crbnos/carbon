// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type Violation } from "../../check";
import { typescript } from "../../sources/inputs";
import {
  analyzeUnitWrites,
  inUnitWriteScope,
  UNIT_PICK_ALLOW_LIST,
  UNIT_WRITE_ALLOW_LIST
} from "../../sources/mes-unit-writes";
import { lineOf } from "../../sources/text";

// On a later operation of a serial part, a write names the unit the operator
// picked or scanned, never one the server chose. `resolveWorkUnit`
// (apps/mes/app/services/work-unit.server.ts) owns that rule, so every
// top-level function that writes a unit calls it, or is listed in
// `sources/mes-unit-writes.ts` with the reason it does not need to. Only the
// resolver picks a unit on the server.
//
// A nested callback counts as the top-level function it sits in, read as the
// concurrency checks read it (`topLevelRegions`, so a class method is
// `Class.method`). The test holds the allow-lists to the repo (`unitWriters`,
// `unitPickers`): every entry must still name a function that writes or
// picks, so a stale entry cannot pre-approve a later one. The check proves
// that the function calls the resolver, not that it honours the resolver's
// refusal.
export const mesUnitWriteResolvesUnit = defineCheck({
  files: typescript,
  id: "mes-unit-write-resolves-unit",
  description:
    "An MES function that writes a serial unit calls resolveWorkUnit, and only the resolver picks a unit on the server",
  provenance: {
    deprecates:
      "an MES route that checks (or picks) the serial unit it writes on its own",
    replacedBy:
      "`resolveWorkUnit` in apps/mes/app/services/work-unit.server.ts",
    since: "2026-11-18"
  },
  rule() {
    return (file, contents) => {
      if (!inUnitWriteScope(file)) return [];
      const { writes, picks, resolving } = analyzeUnitWrites(file, contents);
      const violations: Violation[] = [];

      for (const pick of picks) {
        if (pick.key in UNIT_PICK_ALLOW_LIST) continue;
        violations.push({
          file,
          line: lineOf(contents, pick.index),
          snippet: pick.snippet,
          message:
            "Only the resolver picks a unit on the server: call resolveWorkUnit, or add the function to UNIT_PICK_ALLOW_LIST with the reason"
        });
      }

      for (const write of writes) {
        if (write.key in UNIT_WRITE_ALLOW_LIST) continue;
        if (write.region && resolving.has(write.region)) continue;
        violations.push({
          file,
          line: lineOf(contents, write.index),
          snippet: write.snippet,
          message:
            "This writes a serial unit: call resolveWorkUnit in the same function first, or add the function to UNIT_WRITE_ALLOW_LIST with the reason"
        });
      }
      return violations;
    };
  }
});
