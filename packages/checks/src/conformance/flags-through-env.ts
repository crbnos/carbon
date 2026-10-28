// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// Feature flags are read through one typed API: `flags.*` and
// `evaluateBrowserFlags` from `@carbon/env/flags.server`, and
// `useFlags().feature(key)` in React. That API requires `companyId` (a call
// without it matches no company rule and silently answers the default) and
// takes each default from the registry (`FLAGS`), so two call sites cannot
// disagree. A direct OpenFeature client skips both.
const OPENFEATURE_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']@openfeature\/[^"']*["']/g;

// The provider itself, and its tests.
const EXCLUDED = [/^packages\/env\/src\//];

export const flagsThroughEnv: ConformanceCheck = {
  id: "flags-through-env",
  description:
    "Read feature flags with flags.* from @carbon/env/flags.server, never with an OpenFeature client",
  provenance: {
    deprecates: "direct @openfeature/* imports outside packages/env",
    replacedBy:
      "flags.bool / flags.string / flags.number and evaluateBrowserFlags (@carbon/env/flags.server), useFlags().feature(key)",
    since: ".ai/specs/2026-10-28-feature-flags.md"
  },
  scan(file: string, contents: string): Violation[] {
    if (EXCLUDED.some((pattern) => pattern.test(file))) return [];

    const violations: Violation[] = [];
    contents.split("\n").forEach((text, i) => {
      OPENFEATURE_IMPORT.lastIndex = 0;
      for (const match of text.matchAll(OPENFEATURE_IMPORT)) {
        violations.push({
          file,
          line: i + 1,
          snippet: match[0],
          message:
            "Read flags with `flags.*` from `@carbon/env/flags.server` (or `useFlags().feature(key)` in React), so `companyId` is required and the default comes from the registry."
        });
      }
    });
    return violations;
  }
};
