import type { ConformanceCheck, Violation } from "../check";

/**
 * A tracked entity's quantity is the physical truth about a lot on a shelf, and
 * `trackedEntity.quantity` is a bare NUMERIC — so whatever float a writer hands
 * it is what is stored. Two defect classes follow from that, and both shipped:
 *
 * 1. **Unrounded arithmetic reaching storage.** A lot left holding
 *    `0.020000000000000018` after an earlier split reads "0.02" in every UI and
 *    behaves like 0.02 nowhere. Round at the persist boundary — via `round()`
 *    from `functions/shared/precision.ts` / `@carbon/utils`, or (better) via
 *    `settleQuantity()` from `functions/shared/entity-drain.ts`, which rounds,
 *    refuses a negative, and applies the drain-to-Consumed rule in one step.
 *
 * 2. **A raw compare on that stored float deciding a split.** `entity.quantity
 *    !== drawn` reads a residue full draw as PARTIAL, and the split builder then
 *    throws its own `draw >= parentQty` guard as a 500 on a legitimate full
 *    pick — or mints a child entity holding 1.8e-17. Use `isFullDraw()` from
 *    `functions/shared/batch-split.ts` (the one split gate, so a caller's
 *    decision and the builder's guard can never disagree) or `equals()` on
 *    rounded values.
 *
 * Scope is deliberately what a single file can PROVE, not everything that could
 * be wrong:
 *
 * - The write rule looks at one `.updateTable("trackedEntity")` statement and
 *   asks whether the standard was used anywhere in it. A `quantity:` set from a
 *   variable rounded three lines up is fine and unflaggable either way; what it
 *   catches is the shape that actually shipped — arithmetic spelled out inline
 *   in the `.set`, with no `round` in sight.
 * - The compare rule only fires on a `.quantity` read straight off a row, which
 *   is unrounded BY CONSTRUCTION. A comparison of two locals is presumed to have
 *   been rounded where they were defined; comparisons against a literal
 *   (`> 0`, `!== 1`, `<= 0`) are "is there any stock" / "is this a serial"
 *   tests, not split gates, and are not flagged.
 *
 * See `.claude/rules/traceability-model.md` and `.claude/rules/numeric-precision.md`.
 */

const MESSAGE_WRITE =
  "Unrounded arithmetic written to trackedEntity.quantity — the column is bare NUMERIC, so this float is what gets stored. Round at the persist boundary with round(), or settle the whole write with settleQuantity() from shared/entity-drain.ts.";

const MESSAGE_COMPARE =
  "Raw compare on a stored tracked-entity quantity — a residue value (0.020000000000000018) makes a full draw read as partial. Use isFullDraw() from shared/batch-split.ts for a split gate, or round both sides.";

/** The helpers that satisfy the standard. `equals`/`isFullDraw` are compare-side. */
const SANCTIONED =
  /\bround\s*\(|\bsettleQuantity\s*\(|\bresolveCountedEntity\s*\(/;
const SANCTIONED_COMPARE = /\bround\s*\(|\bequals\s*\(|\bisFullDraw\s*\(/;

/** The modules that IMPLEMENT the standard; they are where the rounding lives. */
const EXCLUDED_FILES = new Set([
  "packages/database/supabase/functions/shared/precision.ts",
  "packages/database/supabase/functions/shared/batch-split.ts",
  "packages/database/supabase/functions/shared/batch-merge.ts",
  "packages/database/supabase/functions/shared/entity-drain.ts"
]);

const isComment = (text: string) => /^\s*(?:\/\/|\/\*|\*)/.test(text);

/** Blank out string and template contents so `eb("quantity", "+", delta)`'s
 *  operator literal is not read as arithmetic. */
const withoutStrings = (text: string) =>
  text
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

const hasArithmetic = (text: string) => /[-+*/]/.test(text);

/** `entity.quantity`, `trackedEntity.quantity`, `parentEntity.quantity` — a
 *  quantity read straight off a row. Bare `parent`/`child` are deliberately NOT
 *  matched: they are also cost-ledger and BOM-line shapes. */
const ENTITY_QUANTITY = String.raw`\w*[Ee]ntity\w*\.quantity`;
const COMPARATOR = String.raw`===|!==|<=|>=|<|>`;
/** Anything that is not a number literal, `undefined` or `null`. */
const NOT_A_LITERAL = String.raw`(?!\s*(?:-?\d|undefined|null)\b)`;

/** `=>` ends in `>`, so an arrow function reads as "compared against whatever
 *  the body starts with". Require the operator not to continue one. */
const NOT_AN_ARROW = String.raw`(?<![=!<>])`;

const COMPARE_PATTERNS = [
  // entity.quantity <op> <non-literal>
  new RegExp(`${ENTITY_QUANTITY}\\s*(?:${COMPARATOR})${NOT_A_LITERAL}`),
  // <anything> <op> entity.quantity  (the operand order post-shipment used)
  new RegExp(
    `${NOT_AN_ARROW}(?:${COMPARATOR})\\s*(?:Number\\()?\\s*${ENTITY_QUANTITY}`
  )
];

export const noUnroundedTrackedQuantity: ConformanceCheck = {
  id: "no-unrounded-tracked-quantity",
  description:
    "A tracked entity's quantity is rounded at the persist boundary (round/settleQuantity) and split gates compare through isFullDraw — never raw float arithmetic or a raw ===/< on a stored quantity.",
  provenance: {
    deprecates:
      'inline unrounded arithmetic in .updateTable("trackedEntity").set({ quantity }) and raw ===/!==/< split gates on trackedEntity.quantity',
    replacedBy:
      "round() / settleQuantity() (functions/shared/entity-drain.ts) at the write, isFullDraw() (functions/shared/batch-split.ts) at the gate",
    since: "2026-09-23"
  },
  scan(file: string, contents: string): Violation[] {
    if (EXCLUDED_FILES.has(file)) return [];
    const violations: Violation[] = [];
    const lines = contents.split("\n");

    // --- Rule 1: the write. One `.updateTable("trackedEntity")` statement at a
    // time, ending at its `.execute(`; a statement that used the standard
    // anywhere is trusted (the rounding is often on the line above the `.set`).
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.includes('.updateTable("trackedEntity")')) continue;
      const stmt: { line: number; text: string }[] = [];
      for (let j = i; j < lines.length; j++) {
        stmt.push({ line: j + 1, text: lines[j]! });
        if (lines[j]!.includes(".execute(")) break;
      }
      const sanctioned = stmt.some(({ text }) => SANCTIONED.test(text));
      if (sanctioned) continue;
      for (const { line, text } of stmt) {
        if (isComment(text)) continue;
        const bare = withoutStrings(text);
        if (/\bquantity:/.test(bare) && hasArithmetic(bare)) {
          violations.push({
            file,
            line,
            snippet: text.trim(),
            message: MESSAGE_WRITE
          });
        }
      }
    }

    // --- Rule 2: the compare.
    lines.forEach((text, i) => {
      if (isComment(text)) return;
      const bare = withoutStrings(text);
      if (SANCTIONED_COMPARE.test(bare)) return;
      if (COMPARE_PATTERNS.some((pattern) => pattern.test(bare))) {
        violations.push({
          file,
          line: i + 1,
          snippet: text.trim(),
          message: MESSAGE_COMPARE
        });
      }
    });

    return violations;
  }
};
