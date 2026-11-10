// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { freeStockByWeek, weekStarts } from "./available-to-promise.ts";
import {
  type DeliveryDecisionInput,
  decideDeliveryDate
} from "./delivery-date-check.ts";

// Today is Tuesday 2026-11-10; a 26-day lead time puts the fence on 2026-12-06.
const TODAY = "2026-11-10";
const FENCE = "2026-12-06";

function base(
  overrides: Partial<DeliveryDecisionInput> = {}
): DeliveryDecisionInput {
  return {
    key: "line",
    control: "Lead Time",
    methodType: "Pull from Inventory",
    todayIso: TODAY,
    promisedDate: "2026-11-17",
    quantity: 30,
    leadTimeDays: 26,
    canMake: true,
    ...overrides
  };
}

/** Free stock per week up to the fence, from on-hand and dated demand. */
function stock(onHand: number, demand: { date: string; quantity: number }[]) {
  const weeks = weekStarts(TODAY, FENCE);
  return {
    weeks,
    free: freeStockByWeek({
      onHand,
      supply: [],
      demand,
      weeks,
      todayIso: TODAY
    })
  };
}

describe("decideDeliveryDate", () => {
  it("passes a line promised on or after the fence without any check", () => {
    expect(decideDeliveryDate(base({ promisedDate: FENCE }))).toMatchObject({
      needsCapacity: false,
      status: "Met",
      constraint: null,
      earliestDate: null
    });
  });

  it("gives the fence as the earliest date under Lead Time", () => {
    expect(decideDeliveryDate(base())).toMatchObject({
      status: "Missed",
      constraint: "Lead Time",
      earliestDate: FENCE,
      fenceDate: FENCE
    });
  });

  it("checks a Purchase to Order line against the fence even under Capacity", () => {
    expect(
      decideDeliveryDate(
        base({ control: "Capacity", methodType: "Purchase to Order" })
      )
    ).toMatchObject({ status: "Missed", constraint: "Lead Time" });
  });

  it("passes a Pull from Inventory line the free stock covers", () => {
    expect(
      decideDeliveryDate(
        base({
          control: "Stock",
          quantity: 20,
          stock: stock(100, [{ date: "2026-11-18", quantity: 80 }])
        })
      )
    ).toMatchObject({ status: "Met", constraint: "Stock", freeQuantity: 20 });
  });

  it("falls back to the fence when no week before it has enough free stock", () => {
    expect(
      decideDeliveryDate(
        base({
          control: "Stock",
          quantity: 30,
          stock: stock(100, [{ date: "2026-11-18", quantity: 80 }])
        })
      )
    ).toMatchObject({
      status: "Missed",
      constraint: "Stock",
      earliestDate: FENCE,
      freeQuantity: 20
    });
  });

  it("does not use finished stock for a Make to Order line under Stock", () => {
    expect(
      decideDeliveryDate(
        base({
          control: "Stock",
          methodType: "Make to Order",
          stock: stock(1000, [])
        })
      )
    ).toMatchObject({ status: "Missed", constraint: "Lead Time" });
  });

  it("asks for a capacity run for a Make to Order line under Capacity", () => {
    expect(
      decideDeliveryDate(
        base({ control: "Capacity", methodType: "Make to Order" })
      )
    ).toEqual({ needsCapacity: true, shortfall: 30 });
  });

  it("gives the capacity finish as the earliest date of a Make to Order line", () => {
    expect(
      decideDeliveryDate(
        base({
          control: "Capacity",
          methodType: "Make to Order",
          capacity: { earliestDate: "2026-11-27", cause: "CNC is busy" }
        })
      )
    ).toMatchObject({
      status: "Missed",
      constraint: "Capacity",
      earliestDate: "2026-11-27",
      cause: "CNC is busy"
    });
  });

  it("falls back to the fence when the item has no routing to schedule", () => {
    expect(
      decideDeliveryDate(
        base({
          control: "Capacity",
          methodType: "Make to Order",
          capacity: { earliestDate: null, cause: null }
        })
      )
    ).toMatchObject({
      status: "Missed",
      constraint: "Lead Time",
      earliestDate: FENCE
    });
  });

  it("runs capacity only for the shortfall the free stock leaves", () => {
    expect(
      decideDeliveryDate(
        base({
          control: "Capacity",
          quantity: 30,
          stock: stock(100, [{ date: "2026-11-18", quantity: 80 }])
        })
      )
    ).toEqual({ needsCapacity: true, shortfall: 10 });
  });

  it("passes a Pull from Inventory line when the shop can make the shortfall in time", () => {
    expect(
      decideDeliveryDate(
        base({
          control: "Capacity",
          stock: stock(100, [{ date: "2026-11-18", quantity: 80 }]),
          capacity: { earliestDate: "2026-11-16", cause: null }
        })
      )
    ).toMatchObject({ status: "Met", constraint: "Capacity" });
  });

  it("skips capacity for a bought item under Capacity", () => {
    expect(
      decideDeliveryDate(
        base({
          control: "Capacity",
          canMake: false,
          stock: stock(0, [])
        })
      )
    ).toMatchObject({
      status: "Missed",
      constraint: "Stock",
      earliestDate: FENCE
    });
  });

  it("passes a made line whose capacity finish is before its promised date", () => {
    expect(
      decideDeliveryDate(
        base({
          control: "Capacity",
          methodType: "Make to Order",
          promisedDate: "2026-11-09",
          capacity: { earliestDate: "2026-11-01", cause: null }
        })
      )
    ).toMatchObject({ status: "Met", constraint: "Capacity" });
  });
});
