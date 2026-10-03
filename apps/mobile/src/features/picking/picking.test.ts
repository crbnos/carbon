// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PickingListLine, PickingTrackedOptions } from "@carbon/mes-core";
import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  cardProgress,
  expiryGate,
  expiryState,
  groupLinesIntoKits,
  isLineFullyPicked,
  isLineResolved,
  isOutOfStock,
  lineBinName,
  lotPickQuantity,
  matchLot,
  nextStatusAction,
  parseNonNegativeQuantity,
  pickedLots,
  quantityOutstanding,
  resolvedLineCount,
  sortLots,
  unresolvedLinesFrom
} from "./logic";

/**
 * The picking decisions worth pinning, all of them pure functions over plain
 * values.
 *
 * Each one is here because getting it wrong is SILENT. An expired lot offered
 * as pickable under a Block policy, a line counted as resolved while it still
 * owes material, a short pick that cannot be answered with zero, a lot
 * quantity that over-picks what is on the shelf — none of these throw. They
 * put the wrong material in a kit, and the kit goes to the machine.
 *
 * No fake API client appears here and no call counts are asserted
 * (`.claude/rules/testing-no-mock-theater.md`): the query hooks and the
 * mutations are glue over `api.request`, verified by typecheck and by the
 * device pass, while every branch that could be wrong lives in `logic.ts`.
 */

const line = (over: Partial<PickingListLine>): PickingListLine => ({
  id: "pll_1",
  itemId: "item_1",
  quantityToPick: 10,
  quantityPicked: 0,
  ...over
});

const lot = (
  over: Partial<PickingTrackedOptions["entities"][number]>
): PickingTrackedOptions["entities"][number] => ({
  trackedEntityId: "te_1",
  ...over
});

const TODAY = parseDate("2026-10-02");

describe("quantityOutstanding", () => {
  it("is what is still owed, floored at zero", () => {
    expect(quantityOutstanding(line({ quantityPicked: 4 }))).toBe(6);
    // Over-picking happens (a batch that came off the reel long). A negative
    // "still to pick" would render as "-2 still to pick" on the row.
    expect(quantityOutstanding(line({ quantityPicked: 12 }))).toBe(0);
  });

  it("reads the fractional quantities a unit of measure allows", () => {
    expect(
      quantityOutstanding(line({ quantityToPick: 2.5, quantityPicked: 0.25 }))
    ).toBe(2.25);
  });
});

describe("isLineResolved", () => {
  it("counts a deliberate answer as resolved, even when short", () => {
    // Short and Cancelled are resolved because the kitter ANSWERED for them.
    // A short pick is "this is all there was", not an omission — and this is
    // the count the list's Finish is judged against.
    expect(isLineResolved(line({ status: "Short", quantityPicked: 3 }))).toBe(
      true
    );
    expect(isLineResolved(line({ status: "Cancelled" }))).toBe(true);
    expect(isLineResolved(line({ quantityPicked: 10 }))).toBe(true);
    expect(isLineResolved(line({ quantityPicked: 11 }))).toBe(true);
  });

  it("does not count an unanswered line, nor an empty one", () => {
    expect(isLineResolved(line({ quantityPicked: 9 }))).toBe(false);
    // A line asking for nothing is NOT resolved. `picked >= toPick` alone
    // would mark 0 >= 0 done and quietly let a Finish through.
    expect(isLineResolved(line({ quantityToPick: 0, quantityPicked: 0 }))).toBe(
      false
    );
  });
});

describe("isLineFullyPicked", () => {
  it("is not the same as resolved — a Short line is resolved but not picked", () => {
    const short = line({ status: "Short", quantityPicked: 3 });
    expect(isLineResolved(short)).toBe(true);
    // The row's controls hang off this: a Short line must still offer Pick,
    // because the kitter may come back when the stock arrives.
    expect(isLineFullyPicked(short)).toBe(false);
  });
});

describe("resolvedLineCount", () => {
  it("is the numerator of the screen's 'N of M lines'", () => {
    expect(
      resolvedLineCount([
        line({ id: "a", quantityPicked: 10 }),
        line({ id: "b", status: "Short", quantityPicked: 1 }),
        line({ id: "c", quantityPicked: 0 }),
        line({ id: "d", status: "Cancelled" })
      ])
    ).toBe(3);
  });
});

describe("isOutOfStock", () => {
  it("is driven by the availability RPC, and treats absent as none", () => {
    expect(isOutOfStock(line({ availableQuantity: 0 }))).toBe(true);
    expect(isOutOfStock(line({ availableQuantity: -4 }))).toBe(true);
    expect(isOutOfStock(line({ availableQuantity: 0.5 }))).toBe(false);
    // Absent reads as "none on record", which is what the warning says. The
    // row still offers Pick — on-hand goes negative until the count is fixed.
    expect(isOutOfStock(line({}))).toBe(true);
  });
});

describe("pickedLots", () => {
  it("keeps only the lots actually picked, with the readable id from the embed", () => {
    const lots = pickedLots(
      line({
        trackedEntities: [
          {
            trackedEntityId: "te_a",
            quantity: 5,
            quantityPicked: 5,
            // Arrives through the contract's `.passthrough()`.
            trackedEntity: { readableId: "LOT-A" }
          },
          // Allocated by the recommendation pass but still in the rack. An
          // Unpick button for this would be an undo of something nobody did.
          { trackedEntityId: "te_b", quantity: 5, quantityPicked: 0 },
          { trackedEntityId: "te_c", quantity: 2, quantityPicked: 2 }
        ]
      } as Partial<PickingListLine>)
    );
    expect(lots).toEqual([
      { trackedEntityId: "te_a", quantityPicked: 5, readableId: "LOT-A" },
      { trackedEntityId: "te_c", quantityPicked: 2, readableId: null }
    ]);
  });

  it("is an empty list when the line carries none", () => {
    expect(pickedLots(line({}))).toEqual([]);
  });
});

describe("lineBinName", () => {
  it("reads the embedded source bin, else null", () => {
    expect(
      lineBinName(
        line({ storageUnit: { name: "A-01-02" } } as Partial<PickingListLine>)
      )
    ).toBe("A-01-02");
    expect(lineBinName(line({}))).toBeNull();
  });
});

describe("groupLinesIntoKits", () => {
  it("groups by job operation and sorts by job then operation", () => {
    const kits = groupLinesIntoKits([
      line({
        id: "a",
        jobOperationId: "op_2",
        job: { jobId: "JOB-2" },
        jobOperation: { process: { name: "Weld" } }
      } as Partial<PickingListLine>),
      line({
        id: "b",
        jobOperationId: "op_1",
        job: { jobId: "JOB-1" },
        jobOperation: {
          process: { name: "Mill" },
          workCenter: { name: "VMC-1" }
        }
      } as Partial<PickingListLine>),
      line({
        id: "c",
        jobOperationId: "op_1",
        job: { jobId: "JOB-1" },
        jobOperation: { process: { name: "Mill" } }
      } as Partial<PickingListLine>)
    ]);

    expect(kits.map((kit) => kit.key)).toEqual(["op_1", "op_2"]);
    expect(kits[0]?.jobReadableId).toBe("JOB-1");
    expect(kits[0]?.workCenterName).toBe("VMC-1");
    // Both of JOB-1's lines stay in the one box — that grouping IS the
    // physical boundary, not a layout choice.
    expect(kits[0]?.lines.map((l) => l.id)).toEqual(["b", "c"]);
  });

  it("keeps lines with no operation in one group rather than dropping them", () => {
    const kits = groupLinesIntoKits([line({ id: "a" }), line({ id: "b" })]);
    expect(kits).toHaveLength(1);
    expect(kits[0]?.key).toBe("ungrouped");
    expect(kits[0]?.lines).toHaveLength(2);
  });
});

describe("cardProgress", () => {
  it("reads the view's aggregates, with absent as zero", () => {
    expect(
      cardProgress({ id: "pl", completedLineCount: 6, lineCount: 14 })
    ).toEqual({ done: 6, total: 14 });
    expect(cardProgress({ id: "pl" })).toEqual({ done: 0, total: 0 });
  });
});

describe("nextStatusAction", () => {
  it("offers exactly the web's two transitions", () => {
    expect(nextStatusAction("Draft")).toEqual({
      kind: "start",
      status: "In Progress"
    });
    expect(nextStatusAction("In Progress")).toEqual({
      kind: "finish",
      status: "Completed"
    });
  });

  it("offers nothing on a terminal list, which the UI disables in place", () => {
    // Reopening is ERP-only (it needs the inventory `delete` permission), so
    // the app must never offer it. Partial is terminal too, which is the easy
    // one to get wrong: it reads like "still in progress".
    expect(nextStatusAction("Completed")).toBeNull();
    expect(nextStatusAction("Partial")).toBeNull();
    expect(nextStatusAction("Cancelled")).toBeNull();
    expect(nextStatusAction(null)).toBeNull();
    expect(nextStatusAction(undefined)).toBeNull();
  });
});

describe("unresolvedLinesFrom", () => {
  it("reads the lines a picking 409 named", () => {
    expect(
      unresolvedLinesFrom({
        unresolvedLines: [
          { itemName: "Bearing 6204", outstanding: 4 },
          { itemName: "Shim 0.5mm", outstanding: 1 }
        ]
      })
    ).toEqual([
      { itemName: "Bearing 6204", outstanding: 4 },
      { itemName: "Shim 0.5mm", outstanding: 1 }
    ]);
  });

  it("is empty for anything that is not that shape", () => {
    // `ApiClientError.details` is whatever the server put in the body. A
    // different failure carrying `details`, or an older server, must leave the
    // dialog empty rather than crash the screen explaining the refusal.
    expect(unresolvedLinesFrom(undefined)).toEqual([]);
    expect(unresolvedLinesFrom(null)).toEqual([]);
    expect(unresolvedLinesFrom("nope")).toEqual([]);
    expect(unresolvedLinesFrom({ unresolvedLines: "nope" })).toEqual([]);
    expect(
      unresolvedLinesFrom({ unresolvedLines: [{ outstanding: 2 }] })
    ).toEqual([]);
    // A named line with a junk quantity is still worth showing by name.
    expect(
      unresolvedLinesFrom({ unresolvedLines: [{ itemName: "Bolt" }] })
    ).toEqual([{ itemName: "Bolt", outstanding: 0 }]);
  });
});

describe("expiryState", () => {
  it("treats yesterday as expired and today as near, never the reverse", () => {
    expect(expiryState("2026-10-01", 0, TODAY)).toBe("expired");
    // Exactly today is NOT expired — the lot is good until the day is out,
    // and a kitter told otherwise goes and fetches fresher stock for nothing.
    expect(expiryState("2026-10-02", 0, TODAY)).toBe("near");
    expect(expiryState("2026-10-03", 0, TODAY)).toBe("ok");
  });

  it("widens 'near' by the company's warning days, inclusive at the edge", () => {
    expect(expiryState("2026-10-09", 7, TODAY)).toBe("near");
    expect(expiryState("2026-10-10", 7, TODAY)).toBe("ok");
    // A negative setting cannot make a future lot expired.
    expect(expiryState("2026-10-03", -5, TODAY)).toBe("ok");
  });

  it("reads a bare date as a calendar day, not as UTC midnight", () => {
    // This is the whole reason `@internationalized/date` is used here:
    // `new Date("2026-10-02")` is UTC midnight, so west of UTC it compares as
    // the day BEFORE and a lot expiring today reads as expired. The comparison
    // is calendar-to-calendar, with no instant and no zone in between.
    expect(expiryState("2026-10-02", 0, parseDate("2026-10-02"))).toBe("near");
  });

  it("is 'none' for no date, and for a date it cannot read", () => {
    expect(expiryState(null, 7, TODAY)).toBe("none");
    expect(expiryState(undefined, 7, TODAY)).toBe("none");
    expect(expiryState("", 7, TODAY)).toBe("none");
    // One malformed row must not take the picker down with it.
    expect(expiryState("not a date", 7, TODAY)).toBe("none");
  });

  it("tolerates a timestamp where a date was expected", () => {
    // The column is a DATE, but a server that ever sends a timestamp must not
    // make every lot unreadable.
    expect(expiryState("2026-10-01T00:00:00.000Z", 0, TODAY)).toBe("expired");
  });
});

describe("expiryGate", () => {
  const expired = lot({ expirationDate: "2026-10-01" });
  const nearly = lot({ expirationDate: "2026-10-03" });
  const fresh = lot({ expirationDate: "2027-01-01" });
  const undated = lot({});

  it("blocks an expired lot only under the Block policy", () => {
    expect(expiryGate(expired, "Block", 7, TODAY)).toBe("blocked");
    expect(expiryGate(expired, "BlockWithOverride", 7, TODAY)).toBe("override");
    // Warn means the kitter decides. Collapsing it into "blocked" would stop
    // a company that allows expired stock from picking any of theirs.
    expect(expiryGate(expired, "Warn", 7, TODAY)).toBe("ok");
  });

  it("never gates a lot that is merely near expiry", () => {
    // FEFO wants exactly this lot used first. Gating it pushes the kitter onto
    // fresher stock and leaves the old lot to expire on the shelf.
    for (const policy of ["Warn", "Block", "BlockWithOverride"] as const) {
      expect(expiryGate(nearly, policy, 7, TODAY)).toBe("ok");
      expect(expiryGate(fresh, policy, 7, TODAY)).toBe("ok");
      expect(expiryGate(undated, policy, 7, TODAY)).toBe("ok");
    }
  });
});

describe("sortLots", () => {
  const a = lot({
    trackedEntityId: "a",
    expirationDate: "2026-12-01",
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const b = lot({
    trackedEntityId: "b",
    expirationDate: "2026-11-01",
    createdAt: "2026-02-01T00:00:00.000Z"
  });
  const undated = lot({
    trackedEntityId: "c",
    createdAt: "2025-01-01T00:00:00.000Z"
  });

  it("puts the soonest expiry first, with undated lots LAST", () => {
    // Nulls last matters: an undated lot sorting as "expires first" would jump
    // the queue ahead of dated stock that genuinely has to be used up.
    expect(
      sortLots([a, undated, b], "FEFO").map((l) => l.trackedEntityId)
    ).toEqual(["b", "a", "c"]);
    expect(
      sortLots([a, undated, b], "Default").map((l) => l.trackedEntityId)
    ).toEqual(["b", "a", "c"]);
  });

  it("orders by age for FIFO and LIFO", () => {
    expect(
      sortLots([a, b, undated], "FIFO").map((l) => l.trackedEntityId)
    ).toEqual(["c", "a", "b"]);
    expect(
      sortLots([a, b, undated], "LIFO").map((l) => l.trackedEntityId)
    ).toEqual(["b", "a", "c"]);
  });

  it("does not mutate the list it was given", () => {
    // The picker re-sorts the query's own data on every order change; sorting
    // in place would rewrite the cache entry under TanStack Query.
    const input = [a, b];
    sortLots(input, "FEFO");
    expect(input.map((l) => l.trackedEntityId)).toEqual(["a", "b"]);
  });
});

describe("lotPickQuantity", () => {
  it("is one unit for a serial, whatever the line still owes", () => {
    expect(lotPickQuantity(lot({ availableQuantity: 1 }), "Serial", 5)).toBe(1);
  });

  it("takes what is owed, clamped to what the lot actually holds", () => {
    expect(lotPickQuantity(lot({ availableQuantity: 50 }), "Batch", 12)).toBe(
      12
    );
    // Picking more than is in the lot would post a movement the shelf cannot
    // back, and the kitter would be told it worked.
    expect(lotPickQuantity(lot({ availableQuantity: 8 }), "Batch", 12)).toBe(8);
  });

  it("offers the whole lot when the line owes nothing", () => {
    // The server floors `quantityRequired` at 0, so 0 is how "nothing
    // outstanding" arrives. A pick of 0 would be a silent no-op the kitter
    // reads as a failed scan.
    expect(lotPickQuantity(lot({ availableQuantity: 8 }), "Batch", 0)).toBe(8);
  });

  it("never returns a negative quantity", () => {
    expect(lotPickQuantity(lot({ availableQuantity: -3 }), "Batch", 5)).toBe(0);
    expect(lotPickQuantity(lot({}), "Batch", 5)).toBe(0);
  });
});

describe("matchLot", () => {
  const lots = [
    lot({ trackedEntityId: "te_a", readableId: "LOT-A" }),
    lot({ trackedEntityId: "te_b", readableId: "LOT-B" })
  ];

  it("matches a scan on either the id or the printed lot number", () => {
    expect(matchLot(lots, "LOT-B")?.trackedEntityId).toBe("te_b");
    expect(matchLot(lots, "te_a")?.trackedEntityId).toBe("te_a");
    // Scanners and keyboard wedges append whitespace.
    expect(matchLot(lots, "  LOT-A \n")?.trackedEntityId).toBe("te_a");
  });

  it("matches nothing for a blank or unknown code", () => {
    expect(matchLot(lots, "")).toBeUndefined();
    expect(matchLot(lots, "   ")).toBeUndefined();
    expect(matchLot(lots, "LOT-Z")).toBeUndefined();
  });
});

describe("parseNonNegativeQuantity", () => {
  it("accepts zero, which is the whole point of the short-pick question", () => {
    // The shelf was empty: nothing was picked, and the line still has to be
    // answered for. The operation screen's `parseQuantity` rejects 0, so
    // reusing it here would disable Mark short for exactly this case.
    expect(parseNonNegativeQuantity("0")).toBe(0);
    expect(parseNonNegativeQuantity("0.0")).toBe(0);
  });

  it("accepts what a kitter can type on a decimal pad", () => {
    expect(parseNonNegativeQuantity("7")).toBe(7);
    expect(parseNonNegativeQuantity(" 3 ")).toBe(3);
    // Five decimals is the quantity kind's scale; nothing may round it away.
    expect(parseNonNegativeQuantity("0.00125")).toBe(0.00125);
  });

  it("rejects everything that is not a decimal number", () => {
    expect(parseNonNegativeQuantity("")).toBeNull();
    expect(parseNonNegativeQuantity(" ")).toBeNull();
    expect(parseNonNegativeQuantity("-3")).toBeNull();
    expect(parseNonNegativeQuantity("abc")).toBeNull();
    // `Number()` would accept both of these: "0x10" as 16, "1e3" as 1000.
    expect(parseNonNegativeQuantity("0x10")).toBeNull();
    expect(parseNonNegativeQuantity("1e3")).toBeNull();
  });
});
