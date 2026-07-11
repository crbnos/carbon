import { describe, expect, it } from "vitest";
import { greedyFillAllocation, sortLotsByPickMethod } from "./allocation";

const lot = (id: string, availableQuantity: number) => ({
  trackedEntityId: id,
  readableId: id,
  availableQuantity
});

describe("greedyFillAllocation", () => {
  it("spills across lots to cover the quantity", () => {
    const picks = greedyFillAllocation([lot("A", 3), lot("B", 5)], 4);
    expect(picks).toEqual([
      {
        trackedEntityId: "A",
        readableId: "A",
        quantity: 3,
        expirationDate: null,
        storageUnitId: null,
        storageUnitName: null
      },
      {
        trackedEntityId: "B",
        readableId: "B",
        quantity: 1,
        expirationDate: null,
        storageUnitId: null,
        storageUnitName: null
      }
    ]);
  });

  it("stops at a single lot when it covers the quantity", () => {
    const picks = greedyFillAllocation([lot("A", 3), lot("B", 5)], 2);
    expect(picks).toEqual([
      {
        trackedEntityId: "A",
        readableId: "A",
        quantity: 2,
        expirationDate: null,
        storageUnitId: null,
        storageUnitName: null
      }
    ]);
  });

  it("never suggests more than the total on-hand", () => {
    const picks = greedyFillAllocation([lot("A", 3), lot("B", 5)], 100);
    expect(picks.map((p) => p.quantity)).toEqual([3, 5]);
  });

  it("returns nothing for zero or negative quantity", () => {
    expect(greedyFillAllocation([lot("A", 3)], 0)).toEqual([]);
    expect(greedyFillAllocation([lot("A", 3)], -1)).toEqual([]);
  });

  it("skips lots with no on-hand", () => {
    const picks = greedyFillAllocation([lot("A", 0), lot("B", 2)], 2);
    expect(picks).toEqual([
      {
        trackedEntityId: "B",
        readableId: "B",
        quantity: 2,
        expirationDate: null,
        storageUnitId: null,
        storageUnitName: null
      }
    ]);
  });

  it("preserves lot pick order (does not reorder the pool)", () => {
    const picks = greedyFillAllocation([lot("B", 1), lot("A", 1)], 2);
    expect(picks.map((p) => p.trackedEntityId)).toEqual(["B", "A"]);
  });
});

describe("sortLotsByPickMethod", () => {
  // Two lots whose expiry order is the opposite of their creation order.
  const A = { id: "A", createdAt: "2026-01-01", expirationDate: "2026-12-01" };
  const B = { id: "B", createdAt: "2026-06-01", expirationDate: "2026-08-01" };
  const lots = [A, B];

  const ids = (sorted: Array<{ id: string }>) => sorted.map((l) => l.id);

  it("FEFO / Default: earliest expiry first", () => {
    expect(ids(sortLotsByPickMethod(lots, "FEFO"))).toEqual(["B", "A"]);
    expect(ids(sortLotsByPickMethod(lots, "Default"))).toEqual(["B", "A"]);
  });

  it("FIFO: oldest createdAt first", () => {
    expect(ids(sortLotsByPickMethod(lots, "FIFO"))).toEqual(["A", "B"]);
  });

  it("LIFO: newest createdAt first", () => {
    expect(ids(sortLotsByPickMethod(lots, "LIFO"))).toEqual(["B", "A"]);
  });

  it("FEFO: null expiry sorts last", () => {
    const noExp = { id: "C", createdAt: "2025-01-01", expirationDate: null };
    expect(ids(sortLotsByPickMethod([noExp, A, B], "FEFO"))).toEqual([
      "B",
      "A",
      "C"
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [A, B];
    sortLotsByPickMethod(input, "FIFO");
    expect(input).toEqual([A, B]);
  });
});
