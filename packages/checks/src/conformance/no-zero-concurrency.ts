import type { ConformanceCheck, Violation } from "../check";

/**
 * Matches `limit: 0` inside an Inngest `concurrency` block.
 *
 * `[^{}]*?` cannot cross a brace, so the match is confined to the concurrency
 * object itself — an unrelated `limit: 0` after it closes (a query limit, a
 * pagination default) is not flagged. A bounded `[\s\S]` span would reach past
 * the `}` and match `concurrency: {}, const q = { limit: 0 }`.
 *
 * The concurrency object contains no nested braces in practice (`limit`, `key`,
 * `scope` are all scalars), so excluding braces entirely is exact rather than
 * approximate.
 */
const ZERO_CONCURRENCY = /concurrency\s*:\s*\{[^{}]*?\blimit\s*:\s*0\b/g;

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
