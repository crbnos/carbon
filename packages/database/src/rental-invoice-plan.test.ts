// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  effectiveInvoiceAutomation,
  type PlannableLine,
  planRentalInvoices,
  RENTAL_HOLD_CHARGES,
  RENTAL_HOLD_EARLY_RETURN,
  rentalHoldRebill
} from "./rental-invoice-plan";

const line = (
  item: string,
  kind: PlannableLine<string>["kind"],
  overrides: Partial<PlannableLine<string>> = {}
): PlannableLine<string> => ({
  item,
  kind,
  isAdjustment: false,
  voidedInvoiceReadableId: null,
  ...overrides
});

describe("planRentalInvoices", () => {
  it("Draft Only keeps rent and charges on one unheld invoice", () => {
    expect(
      planRentalInvoices("Draft Only", [
        line("rent", "Rent"),
        line("damage", "Charge")
      ])
    ).toEqual([
      { lines: ["rent", "damage"], holdReason: null, role: "combined" }
    ]);
  });

  it("Post with rent only drafts one unheld rent invoice", () => {
    expect(planRentalInvoices("Post", [line("rent", "Rent")])).toEqual([
      { lines: ["rent"], holdReason: null, role: "rent" }
    ]);
  });

  it("Post splits rent from charges and holds the charges", () => {
    expect(
      planRentalInvoices("Post", [
        line("rent", "Rent"),
        line("damage", "Charge"),
        line("buyout", "Purchase Option")
      ])
    ).toEqual([
      { lines: ["rent"], holdReason: null, role: "rent" },
      {
        lines: ["damage", "buyout"],
        holdReason: RENTAL_HOLD_CHARGES,
        role: "charges"
      }
    ]);
  });

  it("holds a rent invoice carrying an early-return adjustment", () => {
    expect(
      planRentalInvoices("Post and Email", [
        line("rent", "Rent"),
        line("credit", "Rent", { isAdjustment: true })
      ])
    ).toEqual([
      {
        lines: ["rent", "credit"],
        holdReason: RENTAL_HOLD_EARLY_RETURN,
        role: "rent"
      }
    ]);
  });

  it("Post with charges only drafts one held charges invoice", () => {
    expect(planRentalInvoices("Post", [line("damage", "Charge")])).toEqual([
      { lines: ["damage"], holdReason: RENTAL_HOLD_CHARGES, role: "charges" }
    ]);
  });

  it("holds a re-bill of a voided invoice", () => {
    const planned = planRentalInvoices("Post and Email", [
      line("p1", "Rent", { voidedInvoiceReadableId: "INV-7" }),
      line("p2", "Rent", { voidedInvoiceReadableId: "INV-7" }),
      line("p3", "Rent")
    ]);
    expect(planned).toEqual([
      {
        lines: ["p1", "p2", "p3"],
        holdReason: rentalHoldRebill(["INV-7"]),
        role: "rent"
      }
    ]);
    expect(planned[0]?.holdReason).toBe("Re-billing INV-7, which was voided");
  });

  it("the re-bill hold wins over the early-return hold", () => {
    const planned = planRentalInvoices("Post", [
      line("p1", "Rent", { voidedInvoiceReadableId: "INV-7" }),
      line("credit", "Rent", { isAdjustment: true })
    ]);
    expect(planned[0]?.holdReason).toBe(rentalHoldRebill(["INV-7"]));
  });

  it("names every voided invoice once, in first-seen order", () => {
    expect(rentalHoldRebill(["INV-7", "INV-9"])).toBe(
      "Re-billing INV-7, INV-9, which were voided"
    );
    const planned = planRentalInvoices("Post", [
      line("p1", "Rent", { voidedInvoiceReadableId: "INV-9" }),
      line("p2", "Rent", { voidedInvoiceReadableId: "INV-7" }),
      line("p3", "Rent", { voidedInvoiceReadableId: "INV-9" })
    ]);
    expect(planned[0]?.holdReason).toBe(rentalHoldRebill(["INV-9", "INV-7"]));
  });

  it("Draft Only never holds, even a re-bill", () => {
    expect(
      planRentalInvoices("Draft Only", [
        line("p1", "Rent", { voidedInvoiceReadableId: "INV-7" })
      ])
    ).toEqual([{ lines: ["p1"], holdReason: null, role: "combined" }]);
  });

  it("drafts nothing when nothing is due", () => {
    expect(planRentalInvoices("Draft Only", [])).toEqual([]);
    expect(planRentalInvoices("Post", [])).toEqual([]);
    expect(planRentalInvoices("Post and Email", [])).toEqual([]);
  });
});

describe("effectiveInvoiceAutomation", () => {
  it("falls back to the company mode", () => {
    expect(effectiveInvoiceAutomation(null, "Post")).toBe("Post");
  });

  it("prefers the agreement's override", () => {
    expect(effectiveInvoiceAutomation("Draft Only", "Post and Email")).toBe(
      "Draft Only"
    );
  });
});
