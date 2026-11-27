// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../../check";
import { typescript } from "../../sources/inputs";

// Raw JS rounding on value-bearing numbers loses the numeric standard's
// guarantees: Math.round breaks tie parity with Postgres, Math.ceil on a
// quantity inflates fractional targets (the 4.5 -> 5 consumption bug), and
// toFixed is string arithmetic. Use round/scrapAllowance/applyRate/deriveRate from
// @carbon/utils (defined in @carbon/database/precision).
// Genuinely-integer sites (counts, pagination, geometry, day buckets) are
// baselined, not exempted here. See `.claude/rules/numeric-precision.md`.
export const noRawRounding = defineCheck({
  files: typescript,
  id: "no-raw-rounding",
  description:
    "Value-bearing rounding goes through @carbon/utils round/scrapAllowance/applyRate/deriveRate, not Math.round/ceil/floor or toFixed",
  provenance: {
    deprecates:
      "ad-hoc Math.round/Math.ceil/Math.floor/toFixed on prices, rates, and quantities",
    replacedBy: "round/scrapAllowance/applyRate/deriveRate from @carbon/utils",
    since: "2026-08-11"
  },
  within: "line",
  // The full trimmed line, so two different sites in one file never collapse
  // into one baseline key.
  snippet: "trimmed-line",
  // The precision module IS the implementation of rounding.
  except: ["packages/database/src/precision.ts"],
  banned: [
    {
      pattern: /Math\.(?:round|ceil|floor)\(|\.toFixed\(/g,
      message:
        "Raw rounding — use round/scrapAllowance/applyRate/deriveRate from @carbon/utils (see .claude/rules/numeric-precision.md); baseline only genuinely-integer sites"
    }
  ]
});
