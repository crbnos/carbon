// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Check, fileCheck, type Violation } from "../check";
import { typescript } from "../sources/inputs";

// Checks on numeric precision: value-bearing rounding goes through the
// @carbon/utils helpers, a formatter picks a named kind instead of digit counts,
// and a tracked entity's quantity is rounded where it is written and compared
// through isFullDraw. See `.claude/rules/numeric-precision.md`.

// Raw JS rounding on value-bearing numbers loses the numeric standard's
// guarantees: Math.round breaks tie parity with Postgres, Math.ceil on a
// quantity inflates fractional targets (the 4.5 -> 5 consumption bug), and
// toFixed is string arithmetic. Use round/scrapAllowance/applyRate/deriveRate from
// @carbon/utils (defined in @carbon/database/precision).
// Genuinely-integer sites (counts, pagination, geometry, day buckets) are
// baselined, not exempted here.
const RAW_ROUNDING = /Math\.(?:round|ceil|floor)\(|\.toFixed\(/;

// The precision module IS the implementation of rounding.
const ROUNDING_EXCLUDED_FILES = new Set(["packages/database/src/precision.ts"]);

export const noRawRounding = fileCheck(typescript, {
  id: "no-raw-rounding",
  description:
    "Value-bearing rounding goes through @carbon/utils round/scrapAllowance/applyRate/deriveRate, not Math.round/ceil/floor or toFixed",
  provenance: {
    deprecates:
      "ad-hoc Math.round/Math.ceil/Math.floor/toFixed on prices, rates, and quantities",
    replacedBy: "round/scrapAllowance/applyRate/deriveRate from @carbon/utils",
    since: "2026-08-11"
  },
  scan(file: string, contents: string): Violation[] {
    if (ROUNDING_EXCLUDED_FILES.has(file)) return [];
    const violations: Violation[] = [];
    // Match per line to avoid cross-line lastIndex state, and use the full
    // trimmed line as the snippet so two different sites in one file never
    // collapse into one baseline key.
    contents.split("\n").forEach((text, i) => {
      if (RAW_ROUNDING.test(text)) {
        violations.push({
          file,
          line: i + 1,
          snippet: text.trim(),
          message:
            "Raw rounding — use round/scrapAllowance/applyRate/deriveRate from @carbon/utils (see .claude/rules/numeric-precision.md); baseline only genuinely-integer sites"
        });
      }
    });
    return violations;
  }
});

// Call sites never pick digit counts — they pick a NAMED KIND (money, price,
// percent, quantity) whose digits are defined once in @carbon/utils format.ts.
// Editable inputs must use INPUT_FORMAT.* because react-aria's blur commit
// runs parse(format(x)) — the input formatter is part of arithmetic.
// See .claude/rules/numeric-precision.md.
const INLINE_DIGITS = /minimumFractionDigits|maximumFractionDigits/;

// Naming NO digits is the same violation, and the one that hid longest: a bare
// `style: "currency"` reads as neutral, so nothing flagged it, while Intl
// quietly supplied the CLDR default for the code and `currency.decimalPlaces`
// never got a say. That is how a currency configured to 0 kept rendering 2 —
// and, on an editable input, committed the truncation on blur.
const BARE_CURRENCY_STYLE = /style:\s*["']currency["']/;

// The kinds themselves are built from `style: "currency"` — this is where it is
// SUPPOSED to appear. Everything else picks a kind instead.
const CURRENCY_STYLE_ALLOWED = new Set([
  "packages/utils/src/format.ts",
  // Builds the CLDR-only branch for a currency the group hasn't configured.
  "apps/erp/app/hooks/useCurrencyFormatter.tsx"
]);

// The formatter layer itself is where the digits are DEFINED. Note
// useCurrencyFormatter is deliberately NOT excluded — it delegates to
// moneyFormatOptions, so a digit literal creeping back in should flag.
//
// Nothing else belongs here. A file that merely CONSUMES a kind has no digits
// to exclude, and listing it exempts whatever gets added to it later — three
// hook files were listed for exactly that reason and each exempted zero lines,
// and packages/documents/src/utils/shared.ts was listed because it duplicated
// the money kind instead of importing it, which is the drift this check exists
// to catch rather than something to exempt.
const FRACTION_DIGITS_EXCLUDED_FILES = new Set([
  "packages/utils/src/format.ts"
]);

export const noInlineFractionDigits = fileCheck(typescript, {
  id: "no-inline-fraction-digits",
  description:
    "Pick a named kind from @carbon/utils format.ts (money/price/percent/quantity, INPUT_FORMAT.*) instead of passing digits",
  provenance: {
    deprecates:
      "inline minimumFractionDigits/maximumFractionDigits at call sites",
    replacedBy:
      "moneyFormatOptions + the PERCENT_FORMAT / PERCENT_POINTS_FORMAT / SCALE_FORMAT constants and INPUT_FORMAT from @carbon/utils",
    since: "2026-08-11"
  },
  scan(file: string, contents: string): Violation[] {
    const violations: Violation[] = [];
    const digitsExcluded = FRACTION_DIGITS_EXCLUDED_FILES.has(file);
    const currencyExcluded = CURRENCY_STYLE_ALLOWED.has(file);
    contents.split("\n").forEach((text, i) => {
      if (!digitsExcluded && INLINE_DIGITS.test(text)) {
        violations.push({
          file,
          line: i + 1,
          snippet: text.trim(),
          message:
            "Pick a named kind from @carbon/utils format.ts (money/price/percent/quantity, INPUT_FORMAT.*) instead of passing digits"
        });
        return;
      }
      if (!currencyExcluded && BARE_CURRENCY_STYLE.test(text)) {
        violations.push({
          file,
          line: i + 1,
          snippet: text.trim(),
          message:
            "Naming no digits picks the money kind by omission — Intl's CLDR default wins over currency.decimalPlaces. Use INPUT_FORMAT.money/price for inputs, or the money/price formatter hooks for displays"
        });
      }
    });
    return violations;
  }
});

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

const MESSAGE_WRITE =
  "Unrounded arithmetic written to trackedEntity.quantity — the column is bare NUMERIC, so this float is what gets stored. Round at the persist boundary with round(), or settle the whole write with settleQuantity() from @carbon/utils.";

const MESSAGE_COMPARE =
  "Raw compare on a stored tracked-entity quantity — a residue value (0.020000000000000018) makes a full draw read as partial. Use isFullDraw() from @carbon/utils for a split gate, or round both sides.";

/** The helpers that satisfy the standard. `equals`/`isFullDraw` are compare-side. */
const SANCTIONED =
  /\bround\s*\(|\bsettleQuantity\s*\(|\bresolveCountedEntity\s*\(/;

/** The modules that IMPLEMENT the standard; they are where the rounding lives. */
const TRACKED_QUANTITY_EXCLUDED_FILES = new Set([
  "packages/database/src/precision.ts",
  "packages/utils/src/batch-split.ts",
  "packages/utils/src/batch-merge.ts",
  "packages/utils/src/entity-drain.ts"
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

/** Helper NAMES (no trailing paren) used for the enclosure scan below. */
const SANCTIONED_CALL = /(?:round|settleQuantity|resolveCountedEntity)$/;
const SANCTIONED_COMPARE_CALL = /(?:round|equals|isFullDraw)$/;

/**
 * Is `index` lexically inside a still-open call to one of `names`?
 *
 * This is what scopes the exemption to the operand instead of the whole line:
 * `round(Number(entity.quantity))` encloses its read, while
 * `round(onHand) < entity.quantity` does not. Walks the (string-blanked) text
 * keeping a stack of open parens, each tagged with whether the identifier
 * immediately before it is a sanctioned helper.
 */
function enclosedBySanctioned(
  text: string,
  index: number,
  names: RegExp
): boolean {
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
}

/**
 * The value expression of an object property starting at `from` — up to the
 * comma that ends it AT THE SAME paren/brace depth, or end of line. Bounding by
 * depth is what stops a sibling property's `round()` from exempting this one.
 */
function propertyValue(text: string, from: number): string {
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
}

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

export const noUnroundedTrackedQuantity = fileCheck(typescript, {
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
  scan(file: string, contents: string): Violation[] {
    if (TRACKED_QUANTITY_EXCLUDED_FILES.has(file)) return [];
    const violations: Violation[] = [];
    const lines = contents.split("\n");

    // --- Rule 1: the write. One `.updateTable("trackedEntity")` statement at a
    // time, ending at its `.execute(`. Each `quantity:` property is judged on
    // its OWN expression, not on whether the statement rounds something else.
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.includes('.updateTable("trackedEntity")')) continue;
      const stmt: { line: number; text: string }[] = [];
      for (let j = i; j < lines.length; j++) {
        stmt.push({ line: j + 1, text: lines[j]! });
        if (lines[j]!.includes(".execute(")) break;
      }

      // Statement text with strings blanked, so a helper that opens on an
      // earlier line (`settleQuantity({` …) is still visible as an enclosure.
      const bareLines = stmt.map(({ text }) =>
        isComment(text) ? "" : withoutStrings(text)
      );

      for (let k = 0; k < stmt.length; k++) {
        const bare = bareLines[k]!;
        const prefix = bareLines.slice(0, k).join("\n");
        for (const match of bare.matchAll(/\bquantity:/g)) {
          const at = match.index ?? 0;
          // Inside `settleQuantity({ … })` / `round( … )` opened earlier?
          if (
            enclosedBySanctioned(
              prefix + "\n" + bare,
              prefix.length + 1 + at,
              SANCTIONED_CALL
            )
          ) {
            continue;
          }
          const value = propertyValue(bare, at + match[0].length);
          if (SANCTIONED.test(value)) continue;
          if (!hasArithmetic(value)) continue;
          violations.push({
            file,
            line: stmt[k]!.line,
            snippet: stmt[k]!.text.trim(),
            message: MESSAGE_WRITE
          });
        }
      }
    }

    // --- Rule 2: the compare. Judged per OPERAND: the entity-quantity read
    // must itself be wrapped in a sanctioned call.
    lines.forEach((text, i) => {
      if (isComment(text)) return;
      const bare = withoutStrings(text);
      for (const pattern of COMPARE_PATTERNS) {
        const match = pattern.exec(bare);
        if (!match) continue;
        // Locate the `.quantity` read inside the match and ask whether THAT
        // operand is wrapped — not whether the line mentions a helper at all.
        const local = match[0].search(/\.quantity/);
        const at = (match.index ?? 0) + (local >= 0 ? local : 0);
        if (enclosedBySanctioned(bare, at, SANCTIONED_COMPARE_CALL)) continue;
        violations.push({
          file,
          line: i + 1,
          snippet: text.trim(),
          message: MESSAGE_COMPARE
        });
        return;
      }
    });

    return violations;
  }
});

/** The numbers checks, in the order they are written above. */
export const checks: Check[] = [
  noRawRounding,
  noInlineFractionDigits,
  noUnroundedTrackedQuantity
];
