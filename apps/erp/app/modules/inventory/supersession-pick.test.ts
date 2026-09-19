import { describe, expect, it } from "vitest";
import {
  effectiveSuccessorId,
  type PickSupersession,
  pickSupersessionItemId,
  resolvePickRule,
  resolvePickTarget,
  splitConsumeFirstPick
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

  it("falls back to the predecessor for Prefer New while the successor is out of stock", () => {
    expect(
      resolvePickTarget({
        ...base,
        predecessorInStock: true,
        successorInStock: false,
        supersession: ss({ supersessionMode: "Prefer New" })
      })
    ).toEqual({ kind: "pick", itemId: "OLD", factor: 1 });
  });

  it("keeps Prefer New on the successor when both are out (shortage on the planned part)", () => {
    expect(
      resolvePickTarget({
        ...base,
        predecessorInStock: false,
        successorInStock: false,
        supersession: ss({
          supersessionMode: "Prefer New",
          conversionFactor: 2
        })
      })
    ).toEqual({ kind: "pick", itemId: "SUCC", factor: 2 });
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

  describe("swapped at job creation", () => {
    const swapped = {
      itemId: "SUCC",
      substitutedFromItemId: "OLD",
      substitutionFactor: 2,
      asOfDate: TODAY
    };

    it("Consume First pulls the predecessor while it has stock, in predecessor units", () => {
      expect(
        resolvePickTarget({
          ...swapped,
          predecessorInStock: true,
          successorInStock: true,
          supersession: ss({ supersessionMode: "Consume First" })
        })
      ).toEqual({ kind: "pick", itemId: "OLD", factor: 0.5 });
    });

    it("Consume First moves to the successor once the predecessor is out", () => {
      expect(
        resolvePickTarget({
          ...swapped,
          predecessorInStock: false,
          successorInStock: false,
          supersession: ss({ supersessionMode: "Consume First" })
        })
      ).toEqual({ kind: "pick", itemId: "SUCC", factor: 1 });
    });

    it("Consume First ignores effectivity — the swap already settled it", () => {
      expect(
        resolvePickTarget({
          ...swapped,
          predecessorInStock: true,
          successorInStock: true,
          supersession: ss({
            supersessionMode: "Consume First",
            successorEffectivityDate: "2026-12-31"
          })
        })
      ).toEqual({ kind: "pick", itemId: "OLD", factor: 0.5 });
    });

    it("Prefer New stays on the successor while it has stock", () => {
      expect(
        resolvePickTarget({
          ...swapped,
          predecessorInStock: true,
          successorInStock: true,
          supersession: ss({ supersessionMode: "Prefer New" })
        })
      ).toEqual({ kind: "pick", itemId: "SUCC", factor: 1 });
    });

    it("Prefer New falls back to the predecessor only while the successor is out", () => {
      expect(
        resolvePickTarget({
          ...swapped,
          predecessorInStock: true,
          successorInStock: false,
          supersession: ss({ supersessionMode: "Prefer New" })
        })
      ).toEqual({ kind: "pick", itemId: "OLD", factor: 0.5 });
      expect(
        resolvePickTarget({
          ...swapped,
          predecessorInStock: false,
          successorInStock: false,
          supersession: ss({ supersessionMode: "Prefer New" })
        })
      ).toEqual({ kind: "pick", itemId: "SUCC", factor: 1 });
    });

    it("Stock Only never pulls the spares-only predecessor", () => {
      expect(
        resolvePickTarget({
          ...swapped,
          predecessorInStock: true,
          successorInStock: false,
          supersession: ss({ supersessionMode: "Stock Only" })
        })
      ).toEqual({ kind: "pick", itemId: "SUCC", factor: 1 });
    });

    it("picks the successor when the rule was removed after the swap", () => {
      expect(
        resolvePickTarget({
          ...swapped,
          predecessorInStock: true,
          successorInStock: true,
          supersession: undefined
        })
      ).toEqual({ kind: "pick", itemId: "SUCC", factor: 1 });
    });

    it("a null or zero substitution factor is treated as 1", () => {
      for (const substitutionFactor of [null, 0, "x"]) {
        expect(
          resolvePickTarget({
            ...swapped,
            substitutionFactor,
            predecessorInStock: true,
            successorInStock: true,
            supersession: ss({ supersessionMode: "Consume First" })
          })
        ).toEqual({ kind: "pick", itemId: "OLD", factor: 1 });
      }
    });
  });
});

describe("pickSupersessionItemId", () => {
  it("is the predecessor for a swapped row, else the material's own item", () => {
    expect(
      pickSupersessionItemId({ itemId: "SUCC", substitutedFromItemId: "OLD" })
    ).toBe("OLD");
    expect(
      pickSupersessionItemId({ itemId: "OLD", substitutedFromItemId: null })
    ).toBe("OLD");
    expect(pickSupersessionItemId({ itemId: "OLD" })).toBe("OLD");
  });
});

describe("resolvePickRule", () => {
  const rules = new Map<string, PickSupersession>([
    ["OLD", ss({ successorItemId: "NEW", conversionFactor: 2 })],
    ["NEW", ss({ successorItemId: "NEWER", conversionFactor: 3 })]
  ]);

  it("uses the predecessor's rule for a row swapped to the successor at creation", () => {
    expect(
      resolvePickRule({ itemId: "NEW", substitutedFromItemId: "OLD" }, rules)
    ).toEqual({ rule: rules.get("OLD"), swappedFromItemId: "OLD" });
  });

  it("uses the row's own rule for a line pulled back onto the predecessor, even when the successor has a rule of its own", () => {
    expect(
      resolvePickRule({ itemId: "OLD", substitutedFromItemId: "NEW" }, rules)
    ).toEqual({ rule: rules.get("OLD"), swappedFromItemId: null });
  });

  it("falls back to the row's own rule when the substituted-from item has none", () => {
    const only = new Map([["OLD", rules.get("OLD")!]]);
    expect(
      resolvePickRule({ itemId: "OLD", substitutedFromItemId: "NEW" }, only)
    ).toEqual({ rule: only.get("OLD"), swappedFromItemId: null });
  });

  it("is the row's own rule, unswapped, without provenance", () => {
    expect(resolvePickRule({ itemId: "OLD" }, rules)).toEqual({
      rule: rules.get("OLD"),
      swappedFromItemId: null
    });
    expect(resolvePickRule({ itemId: "X" }, rules)).toEqual({
      rule: undefined,
      swappedFromItemId: null
    });
  });
});

describe("splitConsumeFirstPick", () => {
  const base = {
    needOld: 4,
    perAssemblyOld: 2,
    newPerOld: 1,
    stagedOld: 0,
    stagedNew: 0,
    warehouseOld: 0,
    successorInStock: false
  };
  const split = (overrides: Partial<typeof base>) =>
    splitConsumeFirstPick({ ...base, ...overrides });

  it("picks nothing when one assembly of each part is already at the lineside bin", () => {
    expect(split({ stagedOld: 2, stagedNew: 2, warehouseOld: 1 })).toEqual({
      picks: [],
      warehouseOldUsed: 0,
      stagedOldUsed: 2,
      stagedNewUsed: 2
    });
  });

  it("credits staged material only in whole assemblies", () => {
    expect(
      split({
        stagedOld: 1,
        stagedNew: 1,
        warehouseOld: 0,
        successorInStock: true
      })
    ).toEqual({
      picks: [{ item: "successor", quantity: 4 }],
      warehouseOldUsed: 0,
      stagedOldUsed: 0,
      stagedNewUsed: 0
    });
  });

  it("splits the remainder: predecessor for the assemblies the warehouse covers, successor for the rest", () => {
    expect(split({ warehouseOld: 3 })).toEqual({
      picks: [
        { item: "predecessor", quantity: 2 },
        { item: "successor", quantity: 2 }
      ],
      warehouseOldUsed: 2,
      stagedOldUsed: 0,
      stagedNewUsed: 0
    });
  });

  it("stays on the predecessor as a shortage when neither part is in the warehouse", () => {
    expect(split({ stagedOld: 2, warehouseOld: 1 })).toEqual({
      picks: [{ item: "predecessor", quantity: 2 }],
      warehouseOldUsed: 0,
      stagedOldUsed: 2,
      stagedNewUsed: 0
    });
  });

  it("converts the successor's quantities by the factor in both directions", () => {
    expect(split({ newPerOld: 2, stagedNew: 4, warehouseOld: 2 })).toEqual({
      picks: [{ item: "predecessor", quantity: 2 }],
      warehouseOldUsed: 2,
      stagedOldUsed: 0,
      stagedNewUsed: 4
    });
    expect(split({ newPerOld: 2, warehouseOld: 2 })).toEqual({
      picks: [
        { item: "predecessor", quantity: 2 },
        { item: "successor", quantity: 4 }
      ],
      warehouseOldUsed: 2,
      stagedOldUsed: 0,
      stagedNewUsed: 0
    });
  });

  it("never credits more than the requirement", () => {
    expect(split({ stagedOld: 10 })).toEqual({
      picks: [],
      warehouseOldUsed: 0,
      stagedOldUsed: 4,
      stagedNewUsed: 0
    });
  });
});
