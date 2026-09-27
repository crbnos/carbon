import { describe, expect, it } from "vitest";
import { splitPickAcrossMembers } from "./batch-pick-split";

const sum = (shares: { quantity: number }[]) =>
  shares.reduce((acc, s) => acc + s.quantity, 0);

describe("splitPickAcrossMembers", () => {
  it("splits pro-rata by remaining requirement, summing exactly", () => {
    const shares = splitPickAcrossMembers(
      [
        { jobOperationId: "a", remaining: 4000 },
        { jobOperationId: "b", remaining: 2500 }
      ],
      6500
    );
    expect(shares).toEqual([
      { jobOperationId: "a", quantity: 4000 },
      { jobOperationId: "b", quantity: 2500 }
    ]);
  });

  it("a two-lot pick sequence converges on exact per-member totals", () => {
    // Pick 1: 4,000 of the 6,500 total → pro-rata across both members.
    const first = splitPickAcrossMembers(
      [
        { jobOperationId: "a", remaining: 4000 },
        { jobOperationId: "b", remaining: 2500 }
      ],
      4000
    );
    expect(sum(first)).toBe(4000);
    // Pick 2: the rest, weighted by what each member still needs.
    const remainingA = 4000 - first[0]!.quantity;
    const remainingB = 2500 - first[1]!.quantity;
    const second = splitPickAcrossMembers(
      [
        { jobOperationId: "a", remaining: remainingA },
        { jobOperationId: "b", remaining: remainingB }
      ],
      2500
    );
    expect(first[0]!.quantity + second[0]!.quantity).toBe(4000);
    expect(first[1]!.quantity + second[1]!.quantity).toBe(2500);
    // Both members drew from both picks (pro-rata, not sequential fill).
    expect(first[1]!.quantity).toBeGreaterThan(0);
    expect(second[0]!.quantity).toBeGreaterThan(0);
  });

  it("holds exact sums at 5-decimal quantities", () => {
    const shares = splitPickAcrossMembers(
      [
        { jobOperationId: "a", remaining: 0.00125 },
        { jobOperationId: "b", remaining: 0.00375 },
        { jobOperationId: "c", remaining: 0.005 }
      ],
      0.01
    );
    expect(sum(shares)).toBeCloseTo(0.01, 10);
    expect(shares.map((s) => s.quantity)).toEqual([0.00125, 0.00375, 0.005]);
  });

  it("skips members with nothing remaining", () => {
    const shares = splitPickAcrossMembers(
      [
        { jobOperationId: "done", remaining: 0 },
        { jobOperationId: "open", remaining: 10 }
      ],
      10
    );
    expect(shares).toEqual([{ jobOperationId: "open", quantity: 10 }]);
  });

  it("handles a single open member", () => {
    expect(
      splitPickAcrossMembers([{ jobOperationId: "a", remaining: 7 }], 3)
    ).toEqual([{ jobOperationId: "a", quantity: 3 }]);
  });

  it("rejects a pick exceeding the total remaining", () => {
    expect(() =>
      splitPickAcrossMembers(
        [
          { jobOperationId: "a", remaining: 4 },
          { jobOperationId: "b", remaining: 2 }
        ],
        7
      )
    ).toThrow(/exceeds the batch's remaining requirement/);
  });

  it("rejects when no member has a remaining requirement", () => {
    expect(() =>
      splitPickAcrossMembers([{ jobOperationId: "a", remaining: 0 }], 1)
    ).toThrow(/No member operation still requires this item/);
  });

  // 24 mg and 48 mg of an additive held in KG: finer than the 5-digit scale a
  // quantity input accepts, so 0.000072 itself can never be picked.
  it("compares a sub-scale requirement at internal scale", () => {
    const members = [
      { jobOperationId: "a", remaining: 0.000024 },
      { jobOperationId: "b", remaining: 0.000048 }
    ];
    const shares = splitPickAcrossMembers(members, 0.00007);
    expect(sum(shares)).toBeCloseTo(0.00007, 10);
    expect(() => splitPickAcrossMembers(members, 1)).toThrow(
      "Pick of 1 exceeds the batch's remaining requirement of 0.00007"
    );
    // What is left once the pickable 0.00007 is issued counts as covered.
    expect(() =>
      splitPickAcrossMembers(
        [{ jobOperationId: "a", remaining: 0.000004 }],
        0.00001
      )
    ).toThrow(/No member operation still requires this item/);
  });

  it("rejects a non-positive pick quantity", () => {
    expect(() =>
      splitPickAcrossMembers([{ jobOperationId: "a", remaining: 5 }], 0)
    ).toThrow(/greater than zero/);
  });
});
