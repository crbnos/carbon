// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  shipmentDeliveryRefusal,
  summarizeTransitStats,
  type TransitStatsRow
} from "./inventory.utils";

// Posted Friday 2026-11-20. Business days: Mon 23 = 1 … Fri 27 = 5.
const row = (
  deliveredDate: string,
  estimatedDeliveryDate: string | null = "2026-11-25",
  promisedArrival: string | null = "2026-11-26"
): TransitStatsRow => ({
  postingDate: "2026-11-20",
  deliveredDate,
  estimatedDeliveryDate,
  promisedArrival
});

describe("summarizeTransitStats", () => {
  it("returns only the count below 5 shipments", () => {
    expect(
      summarizeTransitStats(
        [row("2026-11-24")].concat(Array(3).fill(row("2026-11-24")))
      )
    ).toEqual({
      count: 4,
      averageDays: null,
      byEstimateRate: null,
      byPromiseRate: null,
      suggestedDays: null
    });
  });

  it("averages business days and suggests the average rounded up", () => {
    const stats = summarizeTransitStats([
      row("2026-11-24"), // 2
      row("2026-11-25"), // 3
      row("2026-11-25"), // 3
      row("2026-11-26"), // 4
      row("2026-11-27") // 5
    ]);
    expect(stats.averageDays).toBe(3.4);
    expect(stats.suggestedDays).toBe(4);
  });

  it("counts an early delivery as on time, against each reference", () => {
    const stats = summarizeTransitStats([
      row("2026-11-24"),
      row("2026-11-25"),
      row("2026-11-25"),
      row("2026-11-26"),
      row("2026-11-27")
    ]);
    // estimate 25th: 3 of 5; promise 26th: 4 of 5
    expect(stats.byEstimateRate).toBe(0.6);
    expect(stats.byPromiseRate).toBe(0.8);
  });

  it("leaves out rows with no reference date", () => {
    const stats = summarizeTransitStats([
      row("2026-11-24", null, null),
      row("2026-11-25", null, null),
      row("2026-11-25", "2026-11-25", null),
      row("2026-11-26", null, null),
      row("2026-11-27", null, null)
    ]);
    expect(stats.byEstimateRate).toBe(1);
    expect(stats.byPromiseRate).toBeNull();
  });

  it("does not count a holiday as a transit day", () => {
    const stats = summarizeTransitStats(
      Array(5).fill(row("2026-11-27")),
      new Set(["2026-11-26"])
    );
    expect(stats.averageDays).toBe(4);
  });
});

describe("shipmentDeliveryRefusal", () => {
  const posted = {
    status: "Posted",
    sourceDocument: "Sales Order",
    postingDate: "2026-11-20",
    deliveredSource: null
  } as const;
  const manual = { source: "Manual", today: "2026-11-24" } as const;

  it("allows a date from the posting date to today", () => {
    expect(
      shipmentDeliveryRefusal(posted, {
        ...manual,
        deliveredDate: "2026-11-20"
      })
    ).toBeNull();
    expect(
      shipmentDeliveryRefusal(posted, {
        ...manual,
        deliveredDate: "2026-11-24"
      })
    ).toBeNull();
  });

  it("allows a clear", () => {
    expect(
      shipmentDeliveryRefusal(
        { ...posted, deliveredSource: "Manual" },
        { ...manual, deliveredDate: null }
      )
    ).toBeNull();
  });

  it("refuses a shipment that is not posted", () => {
    expect(
      shipmentDeliveryRefusal(
        { ...posted, status: "Draft" },
        { ...manual, deliveredDate: "2026-11-24" }
      )
    ).toMatch(/posted shipment/);
  });

  it("refuses a shipment that is not from a sales order", () => {
    expect(
      shipmentDeliveryRefusal(
        { ...posted, sourceDocument: "Purchase Order" },
        { ...manual, deliveredDate: "2026-11-24" }
      )
    ).toMatch(/sales order shipment/);
  });

  it("refuses tomorrow", () => {
    expect(
      shipmentDeliveryRefusal(posted, {
        ...manual,
        deliveredDate: "2026-11-25"
      })
    ).toMatch(/future/);
  });

  it("refuses a date before the shipment posted", () => {
    expect(
      shipmentDeliveryRefusal(posted, {
        ...manual,
        deliveredDate: "2026-11-19"
      })
    ).toMatch(/before the shipment posted/);
  });

  it("refuses a carrier date over a date a user entered", () => {
    expect(
      shipmentDeliveryRefusal(
        { ...posted, deliveredSource: "Manual" },
        { source: "Carrier", today: "2026-11-24", deliveredDate: "2026-11-23" }
      )
    ).toMatch(/carrier update/);
  });

  it("lets a user replace a carrier date", () => {
    expect(
      shipmentDeliveryRefusal(
        { ...posted, deliveredSource: "Carrier" },
        { ...manual, deliveredDate: "2026-11-23" }
      )
    ).toBeNull();
  });
});
