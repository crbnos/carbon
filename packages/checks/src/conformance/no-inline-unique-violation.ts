// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { fileCheck, type Violation } from "../check";
import { typescript } from "../sources/inputs";

const UNIQUE_VIOLATION = /["']23505["']/;

/**
 * The helper owns the SQLSTATE. `error-reason.ts` maps every code to a user
 * message, so it names the code as a key, not as a comparison.
 */
const EXEMPT_FILES = new Set([
  "packages/utils/src/errors.ts",
  "packages/utils/src/error-reason.ts"
]);

/**
 * The literals that existed when the check landed are baselined. Each one
 * should move to `isUniqueViolation`; the baseline does not make them right.
 */
export const noInlineUniqueViolation = fileCheck(typescript, {
  id: "no-inline-unique-violation",
  description:
    'Branch on a unique violation with isUniqueViolation(), never a literal "23505".',
  provenance: {
    deprecates: 'error.code === "23505"',
    replacedBy: "isUniqueViolation(error) from @carbon/utils"
  },
  scan(file, contents) {
    if (EXEMPT_FILES.has(file)) return [];
    const violations: Violation[] = [];
    contents.split("\n").forEach((text, i) => {
      if (!UNIQUE_VIOLATION.test(text)) return;
      violations.push({
        file,
        line: i + 1,
        snippet: text.trim(),
        message:
          'Use isUniqueViolation(error) from @carbon/utils. A literal "23505" lets each caller drift on the code, and the helper is the one place the SQLSTATE is named.'
      });
    });
    return violations;
  }
});
