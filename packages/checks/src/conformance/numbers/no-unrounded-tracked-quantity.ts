// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type Violation } from "../../check";
import { typescript } from "../../sources/inputs";

/**
 * A tracked entity's quantity is the physical truth about a lot on a shelf, and
 * `trackedEntity.quantity` is a bare NUMERIC — so whatever float a writer hands
 * it is what is stored. Two defect classes follow from that, and both shipped:
 *
 * 1. **Unrounded arithmetic reaching storage.** A lot left holding
 *    `0.020000000000000018` after an earlier split reads "0.02" in every UI and
 *    behaves like 0.02 nowhere. Round at the persist boundary — via `round()`
 *    from `@carbon/utils`, or (better) via
 *    `settleQuantity()` from `@carbon/utils` (`entity-drain.ts`), which rounds,
 *    refuses a negative, and applies the drain-to-Consumed rule in one step.
 *
 * 2. **A raw compare on that stored float deciding a split.** `entity.quantity
 *    !== drawn` reads a residue full draw as PARTIAL, and the split builder then
 *    throws its own `draw >= parentQty` guard as a 500 on a legitimate full
 *    pick — or mints a child entity holding 1.8e-17. Use `isFullDraw()` from
 *    `@carbon/utils` (`batch-split.ts`, the one split gate, so a caller's
 *    decision and the builder's guard can never disagree) or `equals()` on
 *    rounded values.
 *
 * Scope is deliberately what a single file can PROVE, not everything that could
 * be wrong:
 *
 * - The write rule asks whether THIS `quantity:` expression went through the
 *   standard — either the value itself calls a sanctioned helper, or the
 *   property sits inside one (the `settleQuantity({ quantity: a - b, … })`
 *   shape, where the helper opens on an earlier line). A sanctioned call
 *   elsewhere in the same statement does NOT exempt it: `quantity: a - b`
 *   beside a `readableId: round(x)` is still a finding. A `quantity:` set from
 *   a variable rounded three lines up is fine and unflaggable either way; what
 *   it catches is arithmetic spelled out inline in the `.set`.
 * - The compare rule only fires on a `.quantity` read straight off a row, which
 *   is unrounded BY CONSTRUCTION, and only when THAT operand is not itself
 *   wrapped in a sanctioned call — an unrelated `round()` on the other side of
 *   the comparison does not exempt it. A comparison of two locals is presumed
 *   to have been rounded where they were defined; comparisons against a literal
 *   (`> 0`, `!== 1`, `<= 0`) are "is there any stock" / "is this a serial"
 *   tests, not split gates, and are not flagged.
 *
 * See `.claude/rules/traceability-model.md` and `.claude/rules/numeric-precision.md`.
 */
export const noUnroundedTrackedQuantity = defineCheck({
  files: typescript,
  id: "no-unrounded-tracked-quantity",
  description:
    "A tracked entity's quantity is rounded at the persist boundary (round/settleQuantity) and split gates compare through isFullDraw — never raw float arithmetic or a raw ===/< on a stored quantity.",
  provenance: {
    deprecates:
      'inline unrounded arithmetic in .updateTable("trackedEntity").set({ quantity }) and raw ===/!==/< split gates on trackedEntity.quantity',
    replacedBy:
      "round() / settleQuantity() (@carbon/utils entity-drain.ts) at the write, isFullDraw() (@carbon/utils batch-split.ts) at the gate",
    since: "2026-09-23"
  },
  rule() {
    const messageWrite =
      "Unrounded arithmetic written to trackedEntity.quantity — the column is bare NUMERIC, so this float is what gets stored. Round at the persist boundary with round(), or settle the whole write with settleQuantity() from @carbon/utils.";
    const messageCompare =
      "Raw compare on a stored tracked-entity quantity — a residue value (0.020000000000000018) makes a full draw read as partial. Use isFullDraw() from @carbon/utils for a split gate, or round both sides.";

    // The helpers that satisfy the standard. `equals`/`isFullDraw` are compare-side.
    const sanctioned =
      /\bround\s*\(|\bsettleQuantity\s*\(|\bresolveCountedEntity\s*\(/;
    // Helper NAMES (no trailing paren) used for the enclosure scan below.
    const sanctionedCall = /(?:round|settleQuantity|resolveCountedEntity)$/;
    const sanctionedCompareCall = /(?:round|equals|isFullDraw)$/;

    // The modules that IMPLEMENT the standard; they are where the rounding lives.
    const excludedFiles = new Set([
      "packages/database/src/precision.ts",
      "packages/utils/src/batch-split.ts",
      "packages/utils/src/batch-merge.ts",
      "packages/utils/src/entity-drain.ts"
    ]);

    // `entity.quantity`, `trackedEntity.quantity`, `parentEntity.quantity` — a
    // quantity read straight off a row. Bare `parent`/`child` are deliberately
    // NOT matched: they are also cost-ledger and BOM-line shapes.
    const entityQuantity = String.raw`\w*[Ee]ntity\w*\.quantity`;
    const comparator = String.raw`===|!==|<=|>=|<|>`;
    // Anything that is not a number literal, `undefined` or `null`.
    const notALiteral = String.raw`(?!\s*(?:-?\d|undefined|null)\b)`;
    // `=>` ends in `>`, so an arrow function reads as "compared against
    // whatever the body starts with". Require the operator not to continue one.
    const notAnArrow = String.raw`(?<![=!<>])`;
    const comparePatterns = [
      // entity.quantity <op> <non-literal>
      new RegExp(`${entityQuantity}\\s*(?:${comparator})${notALiteral}`),
      // <anything> <op> entity.quantity  (the operand order post-shipment used)
      new RegExp(
        `${notAnArrow}(?:${comparator})\\s*(?:Number\\()?\\s*${entityQuantity}`
      )
    ];

    const isComment = (text: string) => /^\s*(?:\/\/|\/\*|\*)/.test(text);

    // Blank out string and template contents so `eb("quantity", "+", delta)`'s
    // operator literal is not read as arithmetic.
    const withoutStrings = (text: string) =>
      text
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/`(?:[^`\\]|\\.)*`/g, "``");

    const hasArithmetic = (text: string) => /[-+*/]/.test(text);

    // Is `index` lexically inside a still-open call to one of `names`?
    //
    // This is what scopes the exemption to the operand instead of the whole
    // line: `round(Number(entity.quantity))` encloses its read, while
    // `round(onHand) < entity.quantity` does not. Walks the (string-blanked)
    // text keeping a stack of open parens, each tagged with whether the
    // identifier immediately before it is a sanctioned helper.
    const enclosedBySanctioned = (
      text: string,
      index: number,
      names: RegExp
    ): boolean => {
      const stack: boolean[] = [];
      for (let i = 0; i < index && i < text.length; i++) {
        const ch = text[i];
        if (ch === "(") {
          const before = text.slice(0, i).match(/[A-Za-z_$][\w$]*$/);
          stack.push(before ? names.test(before[0]) : false);
        } else if (ch === ")") {
          stack.pop();
        }
      }
      return stack.some(Boolean);
    };

    // The value expression of an object property starting at `from` — up to
    // the comma that ends it AT THE SAME paren/brace depth, or end of line.
    // Bounding by depth is what stops a sibling property's `round()` from
    // exempting this one.
    const propertyValue = (text: string, from: number): string => {
      let depth = 0;
      for (let i = from; i < text.length; i++) {
        const ch = text[i];
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") {
          if (depth === 0) return text.slice(from, i);
          depth--;
        } else if (ch === "," && depth === 0) return text.slice(from, i);
      }
      return text.slice(from);
    };

    return (file, contents) => {
      if (excludedFiles.has(file)) return [];
      const violations: Violation[] = [];
      const lines = contents.split("\n");

      // --- Rule 1: the write. One `.updateTable("trackedEntity")` statement at
      // a time, ending at its `.execute(`. Each `quantity:` property is judged
      // on its OWN expression, not on whether the statement rounds something
      // else.
      lines.forEach((first, i) => {
        if (!first.includes('.updateTable("trackedEntity")')) return;
        // Each line keeps its text with strings blanked, so a helper that opens
        // on an earlier line (`settleQuantity({` …) is still visible as an
        // enclosure.
        const stmt: { line: number; text: string; bare: string }[] = [];
        for (const [offset, text] of lines.slice(i).entries()) {
          stmt.push({
            line: i + offset + 1,
            text,
            bare: isComment(text) ? "" : withoutStrings(text)
          });
          if (text.includes(".execute(")) break;
        }

        stmt.forEach(({ line, text, bare }, k) => {
          const prefix = stmt
            .slice(0, k)
            .map((earlier) => earlier.bare)
            .join("\n");
          for (const match of bare.matchAll(/\bquantity:/g)) {
            const at = match.index ?? 0;
            // Inside `settleQuantity({ … })` / `round( … )` opened earlier?
            if (
              enclosedBySanctioned(
                prefix + "\n" + bare,
                prefix.length + 1 + at,
                sanctionedCall
              )
            ) {
              continue;
            }
            const value = propertyValue(bare, at + match[0].length);
            if (sanctioned.test(value)) continue;
            if (!hasArithmetic(value)) continue;
            violations.push({
              file,
              line,
              snippet: text.trim(),
              message: messageWrite
            });
          }
        });
      });

      // --- Rule 2: the compare. Judged per OPERAND: the entity-quantity read
      // must itself be wrapped in a sanctioned call.
      lines.forEach((text, i) => {
        // Both patterns need a `.quantity` read, and blanking strings cannot make one.
        if (!text.includes(".quantity") || isComment(text)) return;
        const bare = withoutStrings(text);
        for (const pattern of comparePatterns) {
          const match = pattern.exec(bare);
          if (!match) continue;
          // Locate the `.quantity` read inside the match and ask whether THAT
          // operand is wrapped — not whether the line mentions a helper at all.
          const local = match[0].search(/\.quantity/);
          const at = (match.index ?? 0) + (local >= 0 ? local : 0);
          if (enclosedBySanctioned(bare, at, sanctionedCompareCall)) continue;
          violations.push({
            file,
            line: i + 1,
            snippet: text.trim(),
            message: messageCompare
          });
          return;
        }
      });

      return violations;
    };
  }
});
