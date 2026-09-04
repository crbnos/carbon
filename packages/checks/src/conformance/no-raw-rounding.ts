import type { ConformanceCheck, Violation } from "../check";

// Raw JS rounding on value-bearing numbers loses the numeric standard's
// guarantees: Math.round breaks tie parity with Postgres, Math.ceil on a
// quantity inflates fractional targets (the 4.5 -> 5 consumption bug), and
// toFixed is string arithmetic. Use round/scrapAllowance/applyRate/deriveRate from
// @carbon/utils (or functions/shared/precision.ts in edge functions).
// Genuinely-integer sites (counts, pagination, geometry, day buckets) are
// baselined, not exempted here.
const RAW_ROUNDING = /Math\.(?:round|ceil|floor)\(|\.toFixed\(/;

// The precision module IS the implementation of rounding.
const EXCLUDED_FILES = new Set([
  "packages/database/supabase/functions/shared/precision.ts"
]);

export const noRawRounding: ConformanceCheck = {
  id: "no-raw-rounding",
  description:
    "Value-bearing rounding goes through @carbon/utils round/scrapAllowance/applyRate/deriveRate, not Math.round/ceil/floor or toFixed",
  provenance: {
    deprecates:
      "ad-hoc Math.round/Math.ceil/Math.floor/toFixed on prices, rates, and quantities",
    replacedBy:
      "round/scrapAllowance/applyRate/deriveRate from @carbon/utils (functions/shared/precision.ts)",
    since: "2026-08-11"
  },
  scan(file: string, contents: string): Violation[] {
    if (EXCLUDED_FILES.has(file)) return [];
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
};
