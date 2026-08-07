import type { ConformanceCheck, Violation } from "../check";

/**
 * Matches `limit: 0` inside an Inngest `concurrency` block.
 *
 * Anchored on `concurrency` so an unrelated `limit: 0` (a query limit, a
 * pagination default) isn't flagged. The `[\s\S]*?` spans the newline between
 * `concurrency: {` and `limit: 0`, which is how it is always formatted.
 */
const ZERO_CONCURRENCY = /concurrency\s*:\s*\{[\s\S]{0,120}?limit\s*:\s*0\b/g;

export const noZeroConcurrency: ConformanceCheck = {
  id: "no-zero-concurrency",
  description: "Inngest concurrency.limit must be >= 1.",
  provenance: {
    deprecates: "concurrency: { limit: 0 }",
    replacedBy: "concurrency: { limit: 1 }"
  },
  scan(file, contents) {
    const violations: Violation[] = [];
    for (const m of contents.matchAll(ZERO_CONCURRENCY)) {
      violations.push({
        file,
        line: contents.slice(0, m.index).split("\n").length,
        snippet: m[0].replace(/\s+/g, " "),
        message:
          "concurrency.limit 0 is no capacity, not unlimited — every run parks in QUEUED forever. Use >= 1, or omit the concurrency block."
      });
    }
    return violations;
  }
};
