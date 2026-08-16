import type { ConformanceCheck, Violation } from "../check";

// Call sites never pick digit counts — they pick a NAMED KIND (money, price,
// percent, quantity) whose digits are defined once in @carbon/utils format.ts.
// Editable inputs must use INPUT_FORMAT.* because react-aria's blur commit
// runs parse(format(x)) — the input formatter is part of arithmetic.
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
const EXCLUDED_FILES = new Set(["packages/utils/src/format.ts"]);

export const noInlineFractionDigits: ConformanceCheck = {
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
    const digitsExcluded = EXCLUDED_FILES.has(file);
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
};
