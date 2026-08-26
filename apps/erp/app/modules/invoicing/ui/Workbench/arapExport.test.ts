import { describe, expect, it } from "vitest";
import { buildARAPAgingExportRows } from "./arapExport";

describe("buildARAPAgingExportRows", () => {
  it("exports counterparty aging rows and every loaded open invoice row", () => {
    const rows = buildARAPAgingExportRows({
      side: "ar",
      asOfDate: "2026-05-31",
      agingMethod: "documentDate",
      bucketDays: [15, 45, 75],
      aging: [
        {
          customerId: "cust-1",
          paymentTerm: "Net 30",
          current: 100,
          bucket1: 20,
          bucket2: 30,
          bucket3: 40,
          bucket4: 50,
          unapplied: -10,
          total: 230
        }
      ],
      open: [
        {
          invoiceId: "inv-1",
          invoiceNumber: "INV-001",
          documentType: "Invoice",
          dateDue: "2026-05-10",
          currencyCode: "USD",
          exchangeRate: 1,
          totalAmount: 250,
          settled: 20,
          openInCurrency: 230,
          openInBase: 230,
          customerId: "cust-1"
        },
        {
          invoiceId: "inv-2",
          invoiceNumber: "INV-002",
          documentType: "Credit Memo",
          dateDue: null,
          currencyCode: "EUR",
          exchangeRate: 1.1,
          totalAmount: -50,
          settled: 0,
          openInCurrency: -50,
          openInBase: -55,
          customerId: "cust-1"
        }
      ]
    });

    expect(rows).toEqual([
      {
        "As Of Date": "2026-05-31",
        Side: "AR",
        "Aging Method": "documentDate",
        "Bucket Days": "15,45,75",
        "Row Type": "Counterparty",
        "Counterparty Type": "Customer",
        "Counterparty ID": "cust-1",
        "Payment Term": "Net 30",
        "Invoice ID": "",
        "Invoice Number": "",
        "Document Type": "",
        "Due Date": "",
        Currency: "",
        Current: 100,
        "1-15": 20,
        "16-45": 30,
        "46-75": 40,
        "76+": 50,
        Unapplied: -10,
        "Open Amount": 230,
        "Open Amount in Currency": "",
        "Total Amount": "",
        Settled: "",
        "Exchange Rate": ""
      },
      {
        "As Of Date": "2026-05-31",
        Side: "AR",
        "Aging Method": "documentDate",
        "Bucket Days": "15,45,75",
        "Row Type": "Invoice",
        "Counterparty Type": "Customer",
        "Counterparty ID": "cust-1",
        "Payment Term": "",
        "Invoice ID": "inv-1",
        "Invoice Number": "INV-001",
        "Document Type": "Invoice",
        "Due Date": "2026-05-10",
        Currency: "USD",
        Current: "",
        "1-15": "",
        "16-45": "",
        "46-75": "",
        "76+": "",
        Unapplied: "",
        "Open Amount": 230,
        "Open Amount in Currency": 230,
        "Total Amount": 250,
        Settled: 20,
        "Exchange Rate": 1
      },
      {
        "As Of Date": "2026-05-31",
        Side: "AR",
        "Aging Method": "documentDate",
        "Bucket Days": "15,45,75",
        "Row Type": "Invoice",
        "Counterparty Type": "Customer",
        "Counterparty ID": "cust-1",
        "Payment Term": "",
        "Invoice ID": "inv-2",
        "Invoice Number": "INV-002",
        "Document Type": "Credit Memo",
        "Due Date": "",
        Currency: "EUR",
        Current: "",
        "1-15": "",
        "16-45": "",
        "46-75": "",
        "76+": "",
        Unapplied: "",
        "Open Amount": -55,
        "Open Amount in Currency": -50,
        "Total Amount": -50,
        Settled: 0,
        "Exchange Rate": 1.1
      }
    ]);
  });

  it("uses supplier identity for AP exports and includes ungrouped loaded invoices", () => {
    const rows = buildARAPAgingExportRows({
      side: "ap",
      asOfDate: "2026-06-30",
      agingMethod: "dueDate",
      bucketDays: [30, 60, 90],
      aging: [],
      open: [
        {
          invoiceId: "bill-1",
          invoiceNumber: "BILL-001",
          dateDue: "2026-06-01",
          currencyCode: "USD",
          exchangeRate: 1,
          totalAmount: 80,
          settled: 0,
          openInCurrency: 80,
          openInBase: 80,
          supplierId: "sup-1"
        }
      ]
    });

    expect(rows).toEqual([
      {
        "As Of Date": "2026-06-30",
        Side: "AP",
        "Aging Method": "dueDate",
        "Bucket Days": "30,60,90",
        "Row Type": "Invoice",
        "Counterparty Type": "Supplier",
        "Counterparty ID": "sup-1",
        "Payment Term": "",
        "Invoice ID": "bill-1",
        "Invoice Number": "BILL-001",
        "Document Type": "",
        "Due Date": "2026-06-01",
        Currency: "USD",
        Current: "",
        "1-30": "",
        "31-60": "",
        "61-90": "",
        "91+": "",
        Unapplied: "",
        "Open Amount": 80,
        "Open Amount in Currency": 80,
        "Total Amount": 80,
        Settled: 0,
        "Exchange Rate": 1
      }
    ]);
  });
});
