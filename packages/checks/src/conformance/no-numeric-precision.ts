import type { ConformanceCheck, Violation } from "../check";

/** Matches NUMERIC(<int>, <int>) — the deprecated fixed-precision form. */
const NUMERIC_PRECISION = /numeric\s*\(\s*\d+\s*,\s*\d+\s*\)/gi;

export const noNumericPrecision: ConformanceCheck = {
  id: "no-numeric-precision",
  description: "Use bare NUMERIC, not NUMERIC(x,y).",
  provenance: {
    deprecates: "NUMERIC(x,y)",
    replacedBy: "NUMERIC"
  },
  scan(file, contents) {
    const violations: Violation[] = [];
    contents.split("\n").forEach((text, i) => {
      // matchAll on the per-line string avoids cross-line lastIndex state.
      for (const m of text.matchAll(NUMERIC_PRECISION)) {
        violations.push({
          file,
          line: i + 1,
          snippet: m[0],
          message: "NUMERIC(x,y) is deprecated; use bare NUMERIC."
        });
      }
    });
    return violations;
  }
};
