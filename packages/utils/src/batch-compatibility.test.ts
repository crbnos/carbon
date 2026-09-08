import { describe, expect, it } from "vitest";
import {
  compactBatchRules,
  DEFAULT_BATCH_RULES,
  type MemberValueSets,
  mustViolations,
  resolveBatchRules
} from "./batch-compatibility";

describe("resolveBatchRules", () => {
  it("returns today's suggestion-signature defaults for null", () => {
    // These EXACT defaults reproduce lineSignature (substance/grade/dimension).
    // If this ever changes, existing users' suggestion groups reshuffle.
    expect(resolveBatchRules(null)).toEqual({
      item: "ignore",
      substance: "guide",
      grade: "guide",
      dimension: "guide",
      form: "ignore",
      finish: "ignore"
    });
  });

  it("defaults for undefined and empty object match the null case", () => {
    expect(resolveBatchRules(undefined)).toEqual(DEFAULT_BATCH_RULES);
    expect(resolveBatchRules({})).toEqual(DEFAULT_BATCH_RULES);
  });

  it("overrides only the specified dimensions", () => {
    expect(resolveBatchRules({ finish: "must", substance: "ignore" })).toEqual({
      item: "ignore",
      substance: "ignore",
      grade: "guide",
      dimension: "guide",
      form: "ignore",
      finish: "must"
    });
  });

  it("ignores unknown keys and invalid levels", () => {
    const raw = {
      substance: "loud",
      grade: "must",
      bogus: "must"
    } as unknown as Parameters<typeof resolveBatchRules>[0];
    expect(resolveBatchRules(raw)).toEqual({
      ...DEFAULT_BATCH_RULES,
      grade: "must"
    });
  });
});

describe("compactBatchRules", () => {
  it("returns null when everything is at its default (round-trips NULL)", () => {
    expect(compactBatchRules(resolveBatchRules(null))).toBeNull();
  });

  it("keeps only the non-default dimensions", () => {
    const resolved = resolveBatchRules({ finish: "must", grade: "ignore" });
    expect(compactBatchRules(resolved)).toEqual({
      finish: "must",
      grade: "ignore"
    });
  });

  it("round-trips resolve → compact → resolve", () => {
    const sparse = { finish: "must", item: "guide" } as const;
    expect(
      resolveBatchRules(compactBatchRules(resolveBatchRules(sparse)))
    ).toEqual(resolveBatchRules(sparse));
  });
});

describe("mustViolations", () => {
  const rules = resolveBatchRules({ finish: "must" });

  it("passes when all recorded members share a finish value", () => {
    const members: MemberValueSets[] = [
      { finish: ["anodized"] },
      { finish: ["anodized"] }
    ];
    expect(mustViolations(rules, members)).toEqual([]);
  });

  it("violates when no finish value is common to all members", () => {
    const members: MemberValueSets[] = [
      { finish: ["anodized"] },
      { finish: ["powder-coat"] }
    ];
    expect(mustViolations(rules, members)).toEqual(["finish"]);
  });

  it("skips members with no value for the dimension (unrecorded passes)", () => {
    const members: MemberValueSets[] = [
      { finish: ["anodized"] },
      {},
      { finish: [] }
    ];
    expect(mustViolations(rules, members)).toEqual([]);
  });

  it("passes when the intersection is non-empty across multi-valued members", () => {
    const members: MemberValueSets[] = [
      { finish: ["anodized", "powder-coat"] },
      { finish: ["powder-coat"] }
    ];
    expect(mustViolations(rules, members)).toEqual([]);
  });

  it("is order-independent", () => {
    const a: MemberValueSets[] = [{ finish: ["x"] }, {}, { finish: ["y"] }];
    const b: MemberValueSets[] = [{ finish: ["y"] }, { finish: ["x"] }, {}];
    expect(mustViolations(rules, a)).toEqual(mustViolations(rules, b));
  });

  it("never enforces a guide or ignore dimension", () => {
    const guideRules = resolveBatchRules(null); // substance is guide by default
    const members: MemberValueSets[] = [
      { substance: ["steel"] },
      { substance: ["aluminum"] }
    ];
    expect(mustViolations(guideRules, members)).toEqual([]);
  });

  it("reports multiple violated must-dimensions together", () => {
    const multi = resolveBatchRules({ finish: "must", grade: "must" });
    const members: MemberValueSets[] = [
      { finish: ["a"], grade: ["g1"] },
      { finish: ["b"], grade: ["g2"] }
    ];
    expect(mustViolations(multi, members).sort()).toEqual(["finish", "grade"]);
  });

  it("passes a single-member selection", () => {
    expect(mustViolations(rules, [{ finish: ["anodized"] }])).toEqual([]);
  });
});
