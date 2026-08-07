import { describe, expect, it } from "vitest";
import {
  effectiveSuccessorId,
  type PickSupersession,
  resolvePickTarget
} from "./supersession-pick";

const TODAY = "2026-07-30";

const ss = (over: Partial<PickSupersession>): PickSupersession => ({
  supersessionMode: "Consume First",
  successorItemId: "SUCC",
  successorEffectivityDate: null,
  conversionFactor: 1,
  ...over
});

describe("effectiveSuccessorId", () => {
  it("returns the successor when effectivity is null (immediate)", () => {
    expect(effectiveSuccessorId(ss({}), TODAY)).toBe("SUCC");
  });
  it("returns the successor when effectivity date has passed", () => {
    expect(
      effectiveSuccessorId(
        ss({ successorEffectivityDate: "2026-01-01" }),
        TODAY
      )
    ).toBe("SUCC");
  });
  it("returns null before the effectivity date", () => {
    expect(
      effectiveSuccessorId(
        ss({ successorEffectivityDate: "2026-12-31" }),
        TODAY
      )
    ).toBeNull();
  });
  it("returns null when there is no successor", () => {
    expect(
      effectiveSuccessorId(ss({ successorItemId: null }), TODAY)
    ).toBeNull();
  });
});

describe("resolvePickTarget", () => {
  const base = {
    itemId: "OLD",
    predecessorInStock: true,
    successorInStock: true,
    asOfDate: TODAY
  };

  it("picks the item unchanged when there is no supersession", () => {
    expect(resolvePickTarget({ ...base, supersession: undefined })).toEqual({
      kind: "pick",
      itemId: "OLD",
      factor: 1
    });
  });

  it("skips a No Stock (obsolete) material", () => {
    expect(
      resolvePickTarget({
        ...base,
        supersession: ss({
          supersessionMode: "No Stock",
          successorItemId: null
        })
      })
    ).toEqual({ kind: "skip" });
  });

  it("redirects Stock Only to the effective successor with its factor", () => {
    expect(
      resolvePickTarget({
        ...base,
        supersession: ss({
          supersessionMode: "Stock Only",
          conversionFactor: 2
        })
      })
    ).toEqual({ kind: "pick", itemId: "SUCC", factor: 2 });
  });

  it("skips Stock Only when the successor is not yet effective", () => {
    expect(
      resolvePickTarget({
        ...base,
        supersession: ss({
          supersessionMode: "Stock Only",
          successorEffectivityDate: "2026-12-31"
        })
      })
    ).toEqual({ kind: "skip" });
  });

  it("redirects Prefer New to the effective successor", () => {
    expect(
      resolvePickTarget({
        ...base,
        supersession: ss({
          supersessionMode: "Prefer New",
          conversionFactor: 3
        })
      })
    ).toEqual({ kind: "pick", itemId: "SUCC", factor: 3 });
  });

  it("falls back to the predecessor for Prefer New before effectivity", () => {
    expect(
      resolvePickTarget({
        ...base,
        supersession: ss({
          supersessionMode: "Prefer New",
          successorEffectivityDate: "2026-12-31"
        })
      })
    ).toEqual({ kind: "pick", itemId: "OLD", factor: 1 });
  });

  it("keeps Consume First on the predecessor while it has stock", () => {
    expect(
      resolvePickTarget({
        ...base,
        predecessorInStock: true,
        supersession: ss({ supersessionMode: "Consume First" })
      })
    ).toEqual({ kind: "pick", itemId: "OLD", factor: 1 });
  });

  it("redirects Consume First to the successor when the predecessor is out and the successor has stock", () => {
    expect(
      resolvePickTarget({
        ...base,
        predecessorInStock: false,
        successorInStock: true,
        supersession: ss({
          supersessionMode: "Consume First",
          conversionFactor: 2
        })
      })
    ).toEqual({ kind: "pick", itemId: "SUCC", factor: 2 });
  });

  it("keeps Consume First on the predecessor when both are out (shortage the planner resolves)", () => {
    expect(
      resolvePickTarget({
        ...base,
        predecessorInStock: false,
        successorInStock: false,
        supersession: ss({ supersessionMode: "Consume First" })
      })
    ).toEqual({ kind: "pick", itemId: "OLD", factor: 1 });
  });

  it("keeps Consume First on the predecessor when the successor is not yet effective", () => {
    expect(
      resolvePickTarget({
        ...base,
        predecessorInStock: false,
        successorInStock: true,
        supersession: ss({
          supersessionMode: "Consume First",
          successorEffectivityDate: "2026-12-31"
        })
      })
    ).toEqual({ kind: "pick", itemId: "OLD", factor: 1 });
  });
});
