import { describe, expect, it } from "vitest";
import {
  calculateFractionalPriority,
  comparePriorityThenId,
  createDragOrigin,
  getColumnPlacement,
  getItemPlacement,
  isSamePlacement,
  resolveInsertionMarker
} from "./placement";

type TestItem = {
  id: string;
  columnId: string;
  priority: number;
};

const item = (id: string, priority: number, columnId = "a"): TestItem => ({
  id,
  columnId,
  priority
});

describe("placement", () => {
  it("sorts equal priorities by id", () => {
    expect(
      [item("b", 1), item("a", 1), item("c", 0)].sort(comparePriorityThenId)
    ).toEqual([item("c", 0), item("a", 1), item("b", 1)]);
  });

  it("excludes the active item from the origin and destination siblings", () => {
    const origin = createDragOrigin(
      [item("a", 0), item("b", 1), item("c", 2)],
      item("b", 1)
    );

    expect(origin?.placement.slot).toEqual({
      index: 1,
      previousItemId: "a",
      nextItemId: "c"
    });

    const placement = getItemPlacement(
      origin!,
      [item("a", 0), item("b", 1), item("c", 2)],
      "a",
      "c"
    );
    expect(placement?.priority).toBe(3);
    expect(placement?.slot).toEqual({
      index: 2,
      previousItemId: "c",
      nextItemId: null
    });
  });

  it("calculates an upward same-column insertion before the target", () => {
    const origin = createDragOrigin(
      [item("a", 0), item("b", 1), item("c", 2)],
      item("c", 2)
    );

    const placement = getItemPlacement(
      origin!,
      [item("a", 0), item("b", 1), item("c", 2)],
      "a",
      "a"
    );

    expect(placement).toMatchObject({
      priority: -1,
      slot: { previousItemId: null, nextItemId: "a" }
    });
  });

  it("calculates a cross-column insertion before the target", () => {
    const origin = createDragOrigin([item("a", 0)], item("a", 0));
    const destination = [item("b", 10, "b"), item("c", 20, "b")];

    const placement = getItemPlacement(
      origin!,
      [item("a", 0), ...destination],
      "b",
      "c"
    );

    expect(placement).toMatchObject({
      columnId: "b",
      priority: 15,
      slot: { previousItemId: "b", nextItemId: "c" }
    });
  });

  it("allows zero and negative priorities at the top", () => {
    const zeroOrigin = createDragOrigin([item("a", 0)], item("a", 0));
    const zeroPlacement = getItemPlacement(
      zeroOrigin!,
      [item("a", 0), item("b", 0, "b")],
      "b",
      "b"
    );
    expect(zeroPlacement?.priority).toBe(-1);

    const negativeOrigin = createDragOrigin([item("a", -10)], item("a", -10));
    const negativePlacement = getItemPlacement(
      negativeOrigin!,
      [item("a", -10), item("b", -2, "b")],
      "b",
      "b"
    );
    expect(negativePlacement?.priority).toBe(-3);
  });

  it("uses the midpoint in the middle and previous+1 at the bottom", () => {
    const crossColumnOrigin = createDragOrigin([item("a", 0)], item("a", 0));
    const destinationItems = [
      item("a", 0),
      item("b", 0, "b"),
      item("c", 2, "b")
    ];

    expect(
      getItemPlacement(crossColumnOrigin!, destinationItems, "b", "c")?.priority
    ).toBe(1);

    const sameColumnOrigin = createDragOrigin(
      [item("a", 0), item("b", 1), item("c", 2)],
      item("b", 1)
    );
    expect(
      getItemPlacement(
        sameColumnOrigin!,
        [item("a", 0), item("b", 1), item("c", 2)],
        "a",
        "c"
      )?.priority
    ).toBe(3);
  });

  it("accepts an empty column and uses the finite drag-start priority", () => {
    const origin = createDragOrigin([item("a", 7)], item("a", 7));

    expect(getColumnPlacement(origin!, [item("a", 7)], "empty")).toMatchObject({
      columnId: "empty",
      priority: 7,
      slot: { index: 0 }
    });
  });

  it("rejects a populated column with an exact priority collision", () => {
    const origin = createDragOrigin([item("a", 7)], item("a", 7));

    expect(
      getColumnPlacement(
        origin!,
        [item("a", 7), item("b", 0, "b"), item("c", 7, "b")],
        "b"
      )
    ).toBeNull();
  });

  it("does not reuse an earlier card-hover priority for a column fallback", () => {
    const origin = createDragOrigin([item("a", 7)], item("a", 7));
    const items = [item("a", 7), item("b", 0, "b"), item("c", 10, "b")];
    const cardPlacement = getItemPlacement(origin!, items, "b", "c");

    expect(cardPlacement?.priority).toBe(5);
    expect(getColumnPlacement(origin!, items, "b")?.priority).toBe(7);
  });

  it("calculates overflow-safe midpoints across large and mixed signs", () => {
    expect(
      calculateFractionalPriority(Number.MAX_VALUE / 2, Number.MAX_VALUE)
    ).toBe(1.3482698511467367e308);
    expect(
      calculateFractionalPriority(-Number.MAX_VALUE, -Number.MAX_VALUE / 2)
    ).toBe(-1.3482698511467367e308);
    expect(
      calculateFractionalPriority(-Number.MAX_VALUE, Number.MAX_VALUE)
    ).toBe(0);
  });

  it("rejects non-finite inputs and adjacent values without a midpoint", () => {
    expect(calculateFractionalPriority(Number.NaN, 1)).toBeNull();
    expect(calculateFractionalPriority(1, Number.POSITIVE_INFINITY)).toBeNull();
    expect(calculateFractionalPriority(1, 1 + Number.EPSILON)).toBeNull();
  });

  it("treats the original logical slot as a no-op", () => {
    const origin = createDragOrigin(
      [item("a", 0), item("b", 1), item("c", 2)],
      item("b", 1)
    );

    expect(
      isSamePlacement(origin!.placement, {
        columnId: "a",
        priority: 1,
        slot: { index: 1, previousItemId: "a", nextItemId: "c" }
      })
    ).toBe(true);
  });

  it("resolves before and after insertion markers", () => {
    expect(
      resolveInsertionMarker({
        index: 0,
        previousItemId: null,
        nextItemId: "a"
      })
    ).toEqual({ itemId: "a", position: "before" });
    expect(
      resolveInsertionMarker({
        index: 2,
        previousItemId: "b",
        nextItemId: null
      })
    ).toEqual({ itemId: "b", position: "after" });
  });
});
