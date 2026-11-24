// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Node } from "libpg-query";
import type { ConformanceCheck, Violation } from "../check";
import { nameParts, sqlFragments, typeNamesIn } from "../sources/sql";

/** The integer a type modifier holds: the `10` of `NUMERIC(10,2)`. */
function integerOf(modifier: Node): number | undefined {
  return "A_Const" in modifier ? modifier.A_Const.ival?.ival : undefined;
}

export const noNumericPrecision: ConformanceCheck = {
  id: "no-numeric-precision",
  description: "Use bare NUMERIC, not NUMERIC(x,y).",
  provenance: {
    deprecates: "NUMERIC(x,y)",
    replacedBy: "NUMERIC"
  },
  scan(file, contents) {
    const violations: Violation[] = [];
    for (const fragment of sqlFragments(contents)) {
      for (const { names, typmods, location } of typeNamesIn(
        fragment.statements.map((statement) => statement.node)
      )) {
        // NUMERIC and DECIMAL are one type; a precision alone (`NUMERIC(10)`)
        // is an integer bound, not the fixed scale this check retires.
        if (nameParts(names).at(-1) !== "numeric" || typmods?.length !== 2) {
          continue;
        }
        const [precision, scale] = typmods.map(integerOf);
        violations.push({
          file,
          line: fragment.lineAt(location),
          snippet: `NUMERIC(${precision},${scale})`,
          message: "NUMERIC(x,y) is deprecated; use bare NUMERIC."
        });
      }
    }
    return violations;
  }
};
