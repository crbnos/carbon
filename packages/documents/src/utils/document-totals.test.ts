// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  getLineTotal as getPurchaseOrderLineTotal,
  getTotal as getPurchaseOrderTotal
} from "./purchase-order";
import {
  getLineDiscount as getSalesInvoiceLineDiscount,
  getLineGrossMerchandise as getSalesInvoiceLineGrossMerchandise,
  getLineSubtotal as getSalesInvoiceLineSubtotal,
  getLineTaxableSubtotal as getSalesInvoiceLineTaxableSubtotal,
  getLineTotal as getSalesInvoiceLineTotal,
  getTotal as getSalesInvoiceTotal
} from "./sales-invoice";
import {
  getLineSubtotal as getSalesOrderLineSubtotal,
  getLineTaxableSubtotal as getSalesOrderLineTaxableSubtotal
} from "./sales-order";

describe("purchase order totals", () => {
  it("computes qty * price + shipping + tax", () => {
    const line = {
      purchaseQuantity: 100,
      supplierUnitPrice: 5.22,
      supplierShippingCost: 5,
      supplierTaxAmount: 78.3
    } as never;
    expect(getPurchaseOrderLineTotal(line)).toBeCloseTo(605.3);
  });

  it("does not zero out a shipping-only line (zero unit price)", () => {
    const line = {
      purchaseQuantity: 1,
      supplierUnitPrice: 0,
      supplierShippingCost: 30,
      supplierTaxAmount: 0
    } as never;
    expect(getPurchaseOrderLineTotal(line)).toBe(30);
  });

  it("does not zero out a tax-only line (null price)", () => {
    const line = {
      purchaseQuantity: null,
      supplierUnitPrice: null,
      supplierShippingCost: null,
      supplierTaxAmount: 12.5
    } as never;
    expect(getPurchaseOrderLineTotal(line)).toBe(12.5);
  });

  it("sums line totals across lines, including shipping-only lines", () => {
    const lines = [
      {
        purchaseQuantity: 1,
        supplierUnitPrice: 1,
        supplierShippingCost: 5,
        supplierTaxAmount: 0.6
      },
      {
        purchaseQuantity: 1,
        supplierUnitPrice: 0,
        supplierShippingCost: 30,
        supplierTaxAmount: 0
      }
    ] as never[];
    expect(getPurchaseOrderTotal(lines as never)).toBeCloseTo(36.6);
  });
});

describe("sales order line subtotals", () => {
  it("does not zero out a shipping-only line", () => {
    const line = {
      saleQuantity: 1,
      convertedUnitPrice: 0,
      convertedShippingCost: 30
    } as never;
    expect(getSalesOrderLineSubtotal(line)).toBe(30);
    expect(getSalesOrderLineTaxableSubtotal(line)).toBe(30);
  });

  it("includes add-ons alongside price", () => {
    const line = {
      saleQuantity: 2,
      convertedUnitPrice: 10,
      convertedAddOnCost: 3,
      convertedNonTaxableAddOnCost: 2,
      convertedShippingCost: 5
    } as never;
    expect(getSalesOrderLineSubtotal(line)).toBe(30);
    expect(getSalesOrderLineTaxableSubtotal(line)).toBe(28);
  });
});

describe("sales invoice line subtotals", () => {
  it("does not zero out a shipping-only line", () => {
    const line = {
      quantity: 1,
      convertedUnitPrice: 0,
      convertedShippingCost: 30
    } as never;
    expect(getSalesInvoiceLineSubtotal(line)).toBe(30);
    expect(getSalesInvoiceLineTaxableSubtotal(line)).toBe(30);
  });

  it("discounts merchandise only and taxes the discounted amount", () => {
    const line = {
      quantity: 10,
      convertedUnitPrice: 40,
      discountPercent: 0.2,
      taxPercent: 0.1
    } as never;
    expect(getSalesInvoiceLineDiscount(line)).toBeCloseTo(80);
    expect(getSalesInvoiceLineSubtotal(line)).toBeCloseTo(320);
    expect(getSalesInvoiceLineTaxableSubtotal(line)).toBeCloseTo(320);
    expect(getSalesInvoiceLineTotal(line)).toBeCloseTo(352);
    expect(
      getSalesInvoiceTotal(
        [line],
        { exchangeRate: 1 } as never,
        { shippingCost: 0 } as never
      )
    ).toBeCloseTo(352);
  });

  it("never discounts add-ons or shipping", () => {
    const line = {
      quantity: 2,
      convertedUnitPrice: 10,
      discountPercent: 0.5,
      convertedAddOnCost: 3,
      convertedNonTaxableAddOnCost: 2,
      convertedShippingCost: 5
    } as never;
    expect(getSalesInvoiceLineSubtotal(line)).toBe(20);
    expect(getSalesInvoiceLineTaxableSubtotal(line)).toBe(18);
  });

  it("leaves an undiscounted line unchanged", () => {
    const line = {
      quantity: 3,
      convertedUnitPrice: 7.25,
      discountPercent: 0
    } as never;
    expect(getSalesInvoiceLineDiscount(line)).toBe(0);
    expect(getSalesInvoiceLineSubtotal(line)).toBe(3 * 7.25);
  });

  it("summary rows add up: gross subtotal - discount + add-ons + shipping + tax = total", () => {
    // The PDF summary prints Subtotal (gross) -> Discount -> Add-Ons ->
    // Shipping -> Tax -> Total, so those rows must sum to the total.
    const lines = [
      {
        quantity: 10,
        convertedUnitPrice: 40,
        discountPercent: 0.2,
        convertedAddOnCost: 5,
        convertedShippingCost: 10,
        taxPercent: 0.1
      },
      {
        quantity: 2,
        convertedUnitPrice: 15,
        discountPercent: 0,
        convertedNonTaxableAddOnCost: 4,
        taxPercent: 0
      }
    ] as never[];
    const sum = (f: (line: never) => number) =>
      lines.reduce((total, line) => total + f(line), 0);
    const gross = sum(getSalesInvoiceLineGrossMerchandise);
    const discount = sum(getSalesInvoiceLineDiscount);
    const addOns = 5 + 4;
    const shipping = 10 + 20 * 1.1;
    const tax = sum(
      (line) =>
        getSalesInvoiceLineTaxableSubtotal(line) *
        ((line as { taxPercent: number }).taxPercent ?? 0)
    );
    expect(gross).toBe(430);
    expect(discount).toBeCloseTo(80);
    expect(gross - discount + addOns + shipping + tax).toBeCloseTo(
      getSalesInvoiceTotal(
        lines,
        { exchangeRate: 1.1 } as never,
        { shippingCost: 20 } as never
      )
    );
  });
});
