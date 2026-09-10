import type { Violation } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { dedupeViolations, isBlocked } from "./violations";

const v = (
  ruleId: string,
  message: string,
  severity: Violation["severity"] = "error",
  lineId?: string
): Violation => ({ ruleId, severity, message, lineId });

describe("isBlocked", () => {
  it("blocks on any error regardless of acknowledgement", () => {
    expect(isBlocked([v("r1", "nope", "error")], true)).toBe(true);
    expect(isBlocked([v("r1", "nope", "error")], false)).toBe(true);
  });

  it("blocks warns until acknowledged", () => {
    expect(isBlocked([v("r1", "careful", "warn")], false)).toBe(true);
    expect(isBlocked([v("r1", "careful", "warn")], true)).toBe(false);
  });

  it("an error alongside acknowledged warns still blocks", () => {
    const violations = [v("r1", "careful", "warn"), v("r2", "nope", "error")];
    expect(isBlocked(violations, true)).toBe(true);
  });

  it("does not block when there is nothing to block on", () => {
    expect(isBlocked([], false)).toBe(false);
  });
});

describe("dedupeViolations", () => {
  it("collapses identical ruleId + message (the storage-rule contract)", () => {
    const out = dedupeViolations([
      v("r1", "same message"),
      v("r1", "same message")
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps distinct rules and distinct messages", () => {
    const out = dedupeViolations([
      v("r1", "message a"),
      v("r1", "message b"),
      v("r2", "message a")
    ]);
    expect(out).toHaveLength(3);
  });

  it("keeps one entry per line when the same rule fires across lines", () => {
    // A document-level gate needs per-line attribution — collapsing these
    // would lose the ability to point at the offending line.
    const out = dedupeViolations([
      v("r1", "restricted", "error", "line-1"),
      v("r1", "restricted", "error", "line-2")
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.lineId)).toEqual(["line-1", "line-2"]);
  });

  it("still collapses repeats within one line", () => {
    const out = dedupeViolations([
      v("r1", "restricted", "error", "line-1"),
      v("r1", "restricted", "error", "line-1")
    ]);
    expect(out).toHaveLength(1);
  });

  it("treats an absent lineId as its own key, not a wildcard", () => {
    const out = dedupeViolations([
      v("r1", "restricted", "error", undefined),
      v("r1", "restricted", "error", "line-1")
    ]);
    expect(out).toHaveLength(2);
  });

  it("preserves first-seen order", () => {
    const out = dedupeViolations([
      v("r2", "second"),
      v("r1", "first"),
      v("r2", "second")
    ]);
    expect(out.map((x) => x.ruleId)).toEqual(["r2", "r1"]);
  });
});
