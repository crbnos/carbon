import type { ConformanceCheck, Violation } from "../check";

// Call sites never pick digit counts — they pick a NAMED KIND (money, price,
// percent, quantity) whose digits are defined once in @carbon/utils format.ts.
// Editable inputs must use INPUT_FORMAT.* because react-aria's blur commit
// runs parse(format(x)) — the input formatter is part of arithmetic.
const INLINE_DIGITS = /minimumFractionDigits|maximumFractionDigits/;

// The formatter layer itself is where the digits are DEFINED. Note
// useCurrencyFormatter is deliberately NOT excluded — it delegates to
// moneyFormatOptions, so a digit literal creeping back in should flag.
const EXCLUDED_FILES = new Set([
  "packages/utils/src/format.ts",
  "apps/erp/app/hooks/usePercentFormatter.tsx",
  "apps/erp/app/hooks/useQuantityFormatter.tsx",
  "apps/erp/app/hooks/usePriceFormatter.tsx",
  // The documents package's formatter layer (react-pdf can't use the hooks).
  "packages/documents/src/utils/shared.ts"
]);

export const noInlineFractionDigits: ConformanceCheck = {
  id: "no-inline-fraction-digits",
  description:
    "Pick a named kind from @carbon/utils format.ts (money/price/percent/quantity, INPUT_FORMAT.*) instead of passing digits",
  provenance: {
    deprecates:
      "inline minimumFractionDigits/maximumFractionDigits at call sites",
    replacedBy:
      "moneyFormatOptions/priceFormatOptions/percentFormatOptions/quantityFormatOptions + INPUT_FORMAT from @carbon/utils",
    since: "2026-08-11"
  },
  scan(file: string, contents: string): Violation[] {
    if (EXCLUDED_FILES.has(file)) return [];
    const violations: Violation[] = [];
    contents.split("\n").forEach((text, i) => {
      if (INLINE_DIGITS.test(text)) {
        violations.push({
          file,
          line: i + 1,
          snippet: text.trim(),
          message:
            "Pick a named kind from @carbon/utils format.ts (money/price/percent/quantity, INPUT_FORMAT.*) instead of passing digits"
        });
      }
    });
    return violations;
  }
};
