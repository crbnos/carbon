// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

import { parseDate } from "@internationalized/date";
import {
  findPlanningPurchaseOrder,
  isPurchaseOrderEditableFromPlanning,
  planningPurchaseOrderWeek,
  purchaseOrderStatusType,
  taxPairForQuantity
} from "../app/modules/purchasing/purchasing.models";

// The planning gates used isPurchaseOrderLocked, a blocklist of sent
// statuses, so a PO waiting for approval (Needs Approval, To Review,
// Rejected) could still be edited from planning while MRP itself showed
// "Review on PO" for it.
describe("isPurchaseOrderEditableFromPlanning", () => {
  it("allows only a PO that is neither in approval nor sent", () => {
    const editable = purchaseOrderStatusType.filter(
      isPurchaseOrderEditableFromPlanning
    );
    expect(editable).toEqual(["Draft", "Planned"]);
  });

  it("refuses a PO in approval", () => {
    for (const status of ["Needs Approval", "To Review", "Rejected"] as const) {
      expect(isPurchaseOrderEditableFromPlanning(status)).toBe(false);
    }
  });

  it("refuses a PO with no status", () => {
    expect(isPurchaseOrderEditableFromPlanning(null)).toBe(false);
    expect(isPurchaseOrderEditableFromPlanning(undefined)).toBe(false);
  });
});

// A quantity change wrote purchaseQuantity alone. The extended price is a
// generated column and follows; the stored tax amount did not, so the line's
// tax pair stopped agreeing.
describe("taxPairForQuantity", () => {
  const line = {
    supplierUnitPrice: 10,
    supplierShippingCost: 0,
    purchaseQuantity: 10,
    taxPercent: 0.0625,
    supplierTaxAmount: 6.25
  };

  it("restates the amount at the line's rate for the new quantity", () => {
    expect(taxPairForQuantity(line, 20, 2)).toEqual({
      percent: 0.0625,
      amount: 12.5
    });
  });

  it("taxes shipping too, as the canonical base does", () => {
    expect(
      taxPairForQuantity({ ...line, supplierShippingCost: 4 }, 20, 2)
    ).toEqual({ percent: 0.0625, amount: 12.75 });
  });

  it("rounds at the currency's own precision", () => {
    expect(
      taxPairForQuantity(
        { ...line, supplierUnitPrice: 1000, taxPercent: 0.1 },
        3,
        0
      )
    ).toEqual({ percent: 0.1, amount: 300 });
  });

  it("derives the rate once for a line that holds only an amount", () => {
    expect(
      taxPairForQuantity({ ...line, taxPercent: null }, 20, 2)
    ).toEqual({ percent: 0.0625, amount: 12.5 });
  });

  it("keeps a tax-free line tax-free", () => {
    expect(
      taxPairForQuantity(
        { ...line, taxPercent: 0, supplierTaxAmount: 0 },
        20,
        2
      )
    ).toEqual({ percent: 0, amount: 0 });
  });
});

// Planning put every week's order for a supplier on one open PO, so
// finalizing it to send the first week also locked the later weeks, and MRP
// could no longer change them. Orders are now grouped one PO per supplier per
// week. 2026-10-06 is a Tuesday; its week starts on Sunday 2026-10-04.
describe("planningPurchaseOrderWeek", () => {
  const asOf = parseDate("2026-10-06");

  it("starts the week on Sunday, as the planning grid does", () => {
    expect(planningPurchaseOrderWeek("2026-10-10", asOf)).toBe("2026-10-04");
    expect(planningPurchaseOrderWeek("2026-10-11", asOf)).toBe("2026-10-11");
  });

  it("puts each week of a recurring buy in its own week", () => {
    expect(
      ["2026-10-07", "2026-11-01", "2026-11-29"].map((date) =>
        planningPurchaseOrderWeek(date, asOf)
      )
    ).toEqual(["2026-10-04", "2026-11-01", "2026-11-29"]);
  });

  it("puts a late or undated order in the current week", () => {
    expect(planningPurchaseOrderWeek("2026-09-20", asOf)).toBe("2026-10-04");
    expect(planningPurchaseOrderWeek(null, asOf)).toBe("2026-10-04");
  });
});

describe("findPlanningPurchaseOrder", () => {
  const asOf = parseDate("2026-10-06");
  const po = (
    id: string,
    requiredDates: (string | null)[],
    overrides: { supplierId?: string; currencyCode?: string | null } = {}
  ) => ({
    id,
    supplierId: "sup1",
    currencyCode: "USD",
    ...overrides,
    purchaseOrderLine: requiredDates.map((requiredDate) => ({ requiredDate }))
  });
  const target = (week: string) => ({
    supplierId: "sup1",
    currencyCode: "USD",
    week
  });

  it("reuses the PO that already has a line in the week", () => {
    const candidates = [po("oct", ["2026-10-07"]), po("nov", ["2026-11-03"])];
    expect(
      findPlanningPurchaseOrder(candidates, target("2026-11-01"), asOf)?.id
    ).toBe("nov");
  });

  it("does not add a later week to an open PO", () => {
    const candidates = [po("oct", ["2026-10-07"])];
    expect(
      findPlanningPurchaseOrder(candidates, target("2026-11-01"), asOf)
    ).toBeUndefined();
  });

  it("matches a late line to the current week", () => {
    const candidates = [po("late", [null, "2026-09-28"])];
    expect(
      findPlanningPurchaseOrder(candidates, target("2026-10-04"), asOf)?.id
    ).toBe("late");
  });

  it("takes the oldest PO when two cover the week", () => {
    const candidates = [
      po("older", ["2026-10-05"]),
      po("newer", ["2026-10-08"])
    ];
    expect(
      findPlanningPurchaseOrder(candidates, target("2026-10-04"), asOf)?.id
    ).toBe("older");
  });

  it("never reuses a PO in another currency or for another supplier", () => {
    const candidates = [
      po("eur", ["2026-10-07"], { currencyCode: "EUR" }),
      po("other", ["2026-10-07"], { supplierId: "sup2" })
    ];
    expect(
      findPlanningPurchaseOrder(candidates, target("2026-10-04"), asOf)
    ).toBeUndefined();
  });

  // PO000019 was raised before the weekly rule with lines due Oct 4 and
  // Nov 1; reusing it for any week it touched put a new order's two weeks
  // back on one PO.
  it("never reuses a PO with lines in several weeks", () => {
    const candidates = [po("mixed", ["2026-10-04", "2026-11-01"])];
    expect(
      findPlanningPurchaseOrder(candidates, target("2026-10-04"), asOf)
    ).toBeUndefined();
    expect(
      findPlanningPurchaseOrder(candidates, target("2026-11-01"), asOf)
    ).toBeUndefined();
  });

  it("reuses a PO whose lines are all in the week", () => {
    const candidates = [
      po("mixed", ["2026-10-04", "2026-11-01"]),
      po("week", ["2026-10-04", null, "2026-10-09"])
    ];
    expect(
      findPlanningPurchaseOrder(candidates, target("2026-10-04"), asOf)?.id
    ).toBe("week");
  });

  it("never reuses a PO with no lines", () => {
    expect(
      findPlanningPurchaseOrder([po("empty", [])], target("2026-10-04"), asOf)
    ).toBeUndefined();
  });
});
