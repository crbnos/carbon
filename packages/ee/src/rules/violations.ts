// Block/dedupe semantics shared by both rule families (storage + item).
//
// Pure — no client, no env, no I/O. It lives outside `storage/server.ts` so it
// can be unit-tested without dragging in the plan gate's `@carbon/auth` import
// chain (which validates env at module load). `storage/server.ts` re-exports
// both functions, so every existing import path still resolves.

import type { Violation } from "@carbon/utils";

/** Any error blocks unconditionally. Warns block until acknowledged. */
export const isBlocked = (
  violations: Violation[],
  acknowledged: boolean
): boolean => {
  for (let i = 0; i < violations.length; i++) {
    if (violations[i]!.severity === "error") return true;
  }
  return violations.length > 0 && !acknowledged;
};

/**
 * Collapse violations by `ruleId + message + lineId`. Call when accumulating
 * results from multiple evaluator invocations (e.g. item pass + storageUnit
 * pass on the same receipt, or several surfaces on one document).
 *
 * `lineId` participates in the key so a document-level gate keeps one entry per
 * offending line — the UI groups and deep-links off it. Single-line evaluation
 * leaves `lineId` undefined, so the key (and the collapsing behavior storage
 * rules have always had) is unchanged there.
 */
export const dedupeViolations = (violations: Violation[]): Violation[] => {
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (let i = 0; i < violations.length; i++) {
    const v = violations[i]!;
    const key = `${v.ruleId}\x00${v.message}\x00${v.lineId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
};
