// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../check";
import { loadServerFiles } from "../sources/server-files";

// `limit: 0` inside an Inngest `concurrency` block is no capacity, not
// unlimited: every run parks in QUEUED forever.
export const noZeroConcurrency = defineCheck({
  files: loadServerFiles,
  id: "no-zero-concurrency",
  description: "Inngest concurrency.limit must be >= 1.",
  provenance: {
    deprecates: "concurrency: { limit: 0 }",
    replacedBy: "concurrency: { limit: 1 }"
  },
  within: "file",
  snippet: "collapsed-match",
  banned: [
    {
      // `[^{}]*?` cannot cross a brace, so the match is confined to the
      // concurrency object itself — an unrelated `limit: 0` after it closes (a
      // query limit, a pagination default) is not flagged. A bounded `[\s\S]`
      // span would reach past the `}` and match
      // `concurrency: {}, const q = { limit: 0 }`.
      //
      // The concurrency object contains no nested braces in practice (`limit`,
      // `key`, `scope` are all scalars), so excluding braces entirely is exact
      // rather than approximate.
      pattern: /concurrency\s*:\s*\{[^{}]*?\blimit\s*:\s*0\b/g,
      message:
        "concurrency.limit 0 is no capacity, not unlimited — every run parks in QUEUED forever. Use >= 1, or omit the concurrency block."
    }
  ]
});
