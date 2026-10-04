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

import {
  isPurchaseOrderEditableFromPlanning,
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
    for (const status of ["Needs Approval", "To Review", "Rejected"]) {
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
