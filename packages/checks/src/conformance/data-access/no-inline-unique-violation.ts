// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../../check";
import { typescript } from "../../sources/inputs";

// The literals that existed when the check landed are baselined. Each one
// should move to `isUniqueViolation`; the baseline does not make them right.
export const noInlineUniqueViolation = defineCheck({
  files: typescript,
  id: "no-inline-unique-violation",
  description:
    'Branch on a unique violation with isUniqueViolation(), never a literal "23505".',
  provenance: {
    deprecates: 'error.code === "23505"',
    replacedBy: "isUniqueViolation(error) from @carbon/utils"
  },
  within: "file",
  snippet: "trimmed-line",
  // The helper owns the SQLSTATE. `error-reason.ts` maps every code to a user
  // message, so it names the code as a key, not as a comparison.
  except: [
    "packages/utils/src/errors.ts",
    "packages/utils/src/error-reason.ts"
  ],
  banned: [
    {
      pattern: /["']23505["']/g,
      message:
        'Use isUniqueViolation(error) from @carbon/utils. A literal "23505" lets each caller drift on the code, and the helper is the one place the SQLSTATE is named.'
    }
  ]
});
