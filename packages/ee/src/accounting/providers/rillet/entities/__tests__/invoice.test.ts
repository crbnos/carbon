import { describe, expect, it } from "vitest";
import type { Accounting } from "../../../../core/types";
import { mapSalesInvoiceToRilletInvoice } from "../invoice";
import { RILLET_CUSTOMER_CUSTOM_REFERENCE_TYPE } from "../shared";

function invoice(): Accounting.SalesInvoice {
  return {
    id: "si_1",
    invoiceId: "INV-0001",
    companyId: "company-1",
    customerId: "cust-1",
    customerExternalId: "rillet-cust-1",
    status: "Submitted",
    currencyCode: "USD",
    exchangeRate: 1,
    dateIssued: "2026-08-12",
    dateDue: "2026-09-11",
    datePaid: null,
    customerReference: null,
    subtotal: 100,
    totalTax: 0,
    totalDiscount: 0,
    totalAmount: 100,
    balance: 100,
    lines: [
      {
        id: "sil_1",
        invoiceLineType: "Part",
        itemId: "item-1",
        itemCode: "PART-001",
        description: "Widget",
        quantity: 2,
        unitPrice: 50,
        taxPercent: 0,
        lineAmount: 100
      }
    ],
    updatedAt: "2026-08-12T00:00:00.000Z"
  };
}

describe("mapSalesInvoiceToRilletInvoice — external references", () => {
  it("tags the invoice and every item with a CUSTOMER_CUSTOM reference (rev-rec accepted type)", () => {
    const payload = mapSalesInvoiceToRilletInvoice({
      invoice: invoice(),
      customerRemoteId: "rillet-cust-1",
      itemRemoteIds: new Map([["item-1", "rillet-prod-1"]]),
      subsidiaryId: null,
      companyId: "company-1",
      documentUrl: "https://erp.example.test/x/sales-invoice/si_1"
    });

    // Invoice-level: keeps the carbon audit refs AND adds the rev-rec-accepted
    // CUSTOMER_CUSTOM reference so a Revenue-Recognition org accepts the invoice.
    expect(
      payload.external_references?.some(
        (ref) =>
          ref.type === RILLET_CUSTOMER_CUSTOM_REFERENCE_TYPE &&
          ref.id === "si_1"
      )
    ).toBe(true);

    // Every item carries a CUSTOMER_CUSTOM ref keyed by the Carbon line id
    // (rev-rec requires an accepted reference on the invoice items too).
    expect(payload.items).toHaveLength(1);
    expect(
      payload.items[0]?.external_references.some(
        (ref) =>
          ref.type === RILLET_CUSTOMER_CUSTOM_REFERENCE_TYPE &&
          ref.id === "sil_1"
      )
    ).toBe(true);
  });
});
