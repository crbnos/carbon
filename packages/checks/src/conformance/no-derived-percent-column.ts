import type { ConformanceCheck, Violation } from "../check";

// A generated `*Percent`/`*Rate` column whose expression DIVIDES is a lossy
// echo of a rounded amount, not a stored fact — the purchasing taxPercent bug:
// rate = amount / subtotal turned a typed 6.25% into 6.22% after the amount
// was rounded to cents. Percentages are entered facts; amounts derive from
// them (applyRate), never the reverse.
const PERCENT_COLUMN =
  /"[A-Za-z]*(?:Percent|Rate)"\s+[A-Za-z(,0-9\s)]*GENERATED\s+ALWAYS\s+AS/i;

export const noDerivedPercentColumn: ConformanceCheck = {
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
    const lines = contents.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const text = lines[i] ?? "";
      if (!PERCENT_COLUMN.test(text)) continue;

      // The generated expression may span lines until `) STORED`; a division
      // anywhere inside it is the smell. Bound the walk so a malformed
      // migration can't send us to the end of the file.
      let expression = text;
      // A single-line generated column already carries its terminator, so
      // walking on would swallow whatever follows — an unrelated division on
      // the next line would then be blamed on this column.
      if (!/\)\s*STORED/i.test(text)) {
        for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
          const next = lines[j] ?? "";
          expression += `\n${next}`;
          if (/\)\s*STORED/i.test(next)) break;
        }
      }
      if (/STORED/i.test(expression) && expression.includes("/")) {
        violations.push({
          file,
          line: i + 1,
          snippet: text.trim(),
          message:
            "Generated percent/rate column derives by division — store the entered rate and derive the amount via applyRate (@carbon/utils; see .claude/rules/numeric-precision.md)"
        });
      }
    }

    return violations;
  }
};
