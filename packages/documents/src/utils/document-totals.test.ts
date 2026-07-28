import { describe, expect, it } from "vitest";
import {
  getLineTotal as getPurchaseOrderLineTotal,
  getTotal as getPurchaseOrderTotal
} from "./purchase-order";
import {
  getLineSubtotal as getSalesInvoiceLineSubtotal,
  getLineTaxableSubtotal as getSalesInvoiceLineTaxableSubtotal
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
});
