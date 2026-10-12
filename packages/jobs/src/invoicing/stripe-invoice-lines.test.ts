// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The Carbon → Stripe invoice line mapping used by the `Post and Send via
// Stripe` mode. Pure: no Stripe client, env or database.

import {
  expectedConnectInvoiceTotal,
  type SalesInvoiceLineRow,
  stripeDueDate,
  stripeEffectiveDate,
  toStripeInvoiceLines
} from "@carbon/stripe/connect-invoice";
import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";

const line = (overrides: Partial<SalesInvoiceLineRow>): SalesInvoiceLineRow =>
  ({
    id: "sil-1",
    invoiceLineType: "Part",
    description: "Widget",
    quantity: 1,
    unitPrice: 0,
    convertedUnitPrice: 0,
    convertedNetUnitPrice: 0,
    discountPercent: 0,
    exchangeRate: 1,
    addOnCost: 0,
    convertedAddOnCost: 0,
    shippingCost: 0,
    convertedShippingCost: 0,
    nonTaxableAddOnCost: 0,
    convertedNonTaxableAddOnCost: 0,
    taxPercent: 0,
    ...overrides
  }) as SalesInvoiceLineRow;

describe("toStripeInvoiceLines", () => {
  it("sends a discounted line at its net price and never discounts add-ons", () => {
    const [mapped] = toStripeInvoiceLines([
      line({
        quantity: 3,
        unitPrice: 50,
        convertedUnitPrice: 50,
        discountPercent: 0.2,
        convertedNetUnitPrice: 40,
        addOnCost: 10,
        convertedAddOnCost: 10,
        shippingCost: 5,
        convertedShippingCost: 5,
        nonTaxableAddOnCost: 2,
        convertedNonTaxableAddOnCost: 2,
        taxPercent: 0.1
      })
    ]);

    expect(mapped).toMatchObject({
      description: "Widget (20% off)",
      quantity: 3,
      unitPrice: 40,
      addOnCost: 10,
      shippingCost: 5,
      nonTaxableAddOnCost: 2,
      taxPercent: 0.1
    });
    // taxable = 3 × 40 + 10 + 5 = 135; tax = 13.5; +2 untaxed; +7 freight
    expect(
      expectedConnectInvoiceTotal({ lines: [mapped!], shippingCost: 7 })
    ).toEqual({ subtotal: 137, tax: 13.5, shipping: 7, total: 157.5 });
  });

  it("bills a foreign-currency invoice in its own currency, not the base amounts", () => {
    // Base USD 100 at 0.92 EUR per USD, 25% off: the EUR net is 69.
    const [mapped] = toStripeInvoiceLines([
      line({
        quantity: 2,
        exchangeRate: 0.92,
        unitPrice: 100,
        convertedUnitPrice: 92,
        discountPercent: 0.25,
        convertedNetUnitPrice: 69,
        addOnCost: 10,
        convertedAddOnCost: 9.2,
        shippingCost: 20,
        convertedShippingCost: 18.4,
        nonTaxableAddOnCost: 5,
        convertedNonTaxableAddOnCost: 4.6,
        taxPercent: 0.2
      })
    ]);

    expect(mapped).toMatchObject({
      description: "Widget (25% off)",
      unitPrice: 69,
      addOnCost: 9.2,
      shippingCost: 18.4,
      nonTaxableAddOnCost: 4.6
    });
    const total = expectedConnectInvoiceTotal({ lines: [mapped!] });
    // taxable = 2 × 69 + 9.2 + 18.4 = 165.6; tax = 33.12; +4.6 untaxed
    expect(total.subtotal).toBeCloseTo(170.2);
    expect(total.tax).toBeCloseTo(33.12);
    expect(total.total).toBeCloseTo(203.32);
  });

  it("sends the net unit price unrounded", () => {
    const [mapped] = toStripeInvoiceLines([
      line({
        quantity: 1000,
        convertedUnitPrice: 0.0012345,
        discountPercent: 0.1,
        convertedNetUnitPrice: 0.00111105
      })
    ]);
    expect(mapped!.unitPrice).toBe(0.00111105);
    expect(expectedConnectInvoiceTotal({ lines: [mapped!] }).total).toBeCloseTo(
      1.11105
    );
  });

  it("leaves an undiscounted description alone and drops comment lines", () => {
    const mapped = toStripeInvoiceLines([
      line({ convertedUnitPrice: 12, convertedNetUnitPrice: 12 }),
      line({ id: "sil-2", invoiceLineType: "Comment", description: "Note" })
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({ description: "Widget", unitPrice: 12 });
  });
});

// Every write of a Stripe send reuses one idempotency key, and Stripe refuses a
// reused key whose parameters changed: the dates a send carries must not move
// with the clock inside a day.
describe("stripeDueDate", () => {
  const today = parseDate("2026-10-04");

  it("keeps a due date after today", () => {
    expect(stripeDueDate("2026-11-03", today)).toBe("2026-11-03");
  });

  it("drops a due date on or before today, which Stripe refuses", () => {
    expect(stripeDueDate("2026-10-04", today)).toBeUndefined();
    expect(stripeDueDate("2026-09-30", today)).toBeUndefined();
  });

  it("drops a due date more than five years out, or none at all", () => {
    expect(stripeDueDate("2031-10-04", today)).toBe("2031-10-04");
    expect(stripeDueDate("2031-10-05", today)).toBeUndefined();
    expect(stripeDueDate(null, today)).toBeUndefined();
    expect(stripeDueDate("not a date", today)).toBeUndefined();
  });
});

describe("stripeEffectiveDate", () => {
  const today = parseDate("2026-10-04");

  it("keeps an issue date before today", () => {
    expect(stripeEffectiveDate("2026-10-01", today)).toBe("2026-10-01");
  });

  it("leaves an issue date of today or later unset, never 'now'", () => {
    expect(stripeEffectiveDate("2026-10-04", today)).toBeUndefined();
    expect(stripeEffectiveDate("2026-12-01", today)).toBeUndefined();
  });

  it("drops an issue date more than five years back", () => {
    expect(stripeEffectiveDate("2021-10-04", today)).toBe("2021-10-04");
    expect(stripeEffectiveDate("2021-10-03", today)).toBeUndefined();
  });
});
