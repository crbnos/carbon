// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../../check";
import { loadServerFiles } from "../../sources/server-files";

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
      // The concurrency object holds only scalars (`limit`, `key`, `scope`),
      // so a match that cannot cross a brace stays inside it: a `limit: 0`
      // after it closes (a query limit) is not flagged.
      pattern: /concurrency\s*:\s*\{[^{}]*?\blimit\s*:\s*0\b/g,
      message:
        "concurrency.limit 0 is no capacity, not unlimited — every run parks in QUEUED forever. Use >= 1, or omit the concurrency block."
    }
  ]
});
