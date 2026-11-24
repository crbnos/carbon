// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Node } from "libpg-query";
import { fileCheck, type Violation } from "../check";
import { migrations } from "../sources/inputs";
import { nameParts, nodesIn, sqlNodes } from "../sources/sql";

// A generated `*Percent`/`*Rate` column whose expression DIVIDES is a lossy
// echo of a rounded amount, not a stored fact — the purchasing taxPercent bug:
// rate = amount / subtotal turned a typed 6.25% into 6.22% after the amount
// was rounded to cents. Percentages are entered facts; amounts derive from
// them (applyRate), never the reverse.

function divides(expression: Node | undefined): boolean {
  for (const { node } of nodesIn(expression)) {
    if ("A_Expr" in node && nameParts(node.A_Expr.name).includes("/")) {
      return true;
    }
  }
  return false;
}

export const noDerivedPercentColumn = fileCheck(migrations, {
  id: "no-derived-percent-column",
  description:
    "Percent/rate columns must be plain stored values, never GENERATED expressions that divide",
  provenance: {
    deprecates:
      "generated percent columns derived by division (rate = amount / subtotal)",
    replacedBy:
      "writable percent columns; amounts derive via applyRate in @carbon/utils",
    since: "2026-08-11"
  },
  scan(file: string, contents: string): Violation[] {
    const violations: Violation[] = [];
    for (const { node, fragment } of sqlNodes(contents)) {
      if (!("ColumnDef" in node)) continue;
      const { colname = "", constraints, location } = node.ColumnDef;
      const name = colname.toLowerCase();
      if (!name.endsWith("percent") && !name.endsWith("rate")) continue;
      const derived = (constraints ?? []).some(
        (constraint) =>
          "Constraint" in constraint &&
          constraint.Constraint.contype === "CONSTR_GENERATED" &&
          divides(constraint.Constraint.raw_expr)
      );
      if (!derived) continue;
      violations.push({
        file,
        line: fragment.lineAt(location),
        snippet: `"${colname}" GENERATED`,
        message:
          "Generated percent/rate column derives by division — store the entered rate and derive the amount via applyRate (@carbon/utils; see .claude/rules/numeric-precision.md)"
      });
    }
    return violations;
  }
});
