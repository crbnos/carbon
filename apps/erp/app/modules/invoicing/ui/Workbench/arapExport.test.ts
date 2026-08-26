import { describe, expect, it } from "vitest";
import {
  csvIdentifier,
  serializeCsv
} from "../../../accounting/ui/Reports/exportReport";
import {
  buildARAPAgingExportRows,
  canDownloadARAPAgingExport
} from "./arapExport";

describe("buildARAPAgingExportRows", () => {
  it("exports counterparty aging rows and every loaded open invoice row", () => {
    const rows = buildARAPAgingExportRows({
      side: "ar",
      baseCurrencyCode: "USD",
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
        "Counterparty ID": csvIdentifier("cust-1"),
        "Payment Term": "Net 30",
        "Invoice ID": "",
        "Invoice Number": "",
        "Document Type": "",
        "Due Date": "",
        Currency: "USD",
        "Base Currency": "USD",
        "Current (Base Currency)": 100,
        "1-15 (Base Currency)": 20,
        "16-45 (Base Currency)": 30,
        "46-75 (Base Currency)": 40,
        "76+ (Base Currency)": 50,
        "Unapplied (Base Currency)": -10,
        "Open Amount (Base Currency)": 230,
        "Open Amount (Invoice Currency)": "",
        "Total Amount (Invoice Currency)": "",
        "Settled (Invoice Currency)": "",
        "Exchange Rate (Invoice to Base)": ""
      },
      {
        "As Of Date": "2026-05-31",
        Side: "AR",
        "Aging Method": "documentDate",
        "Bucket Days": "15,45,75",
        "Row Type": "Invoice",
        "Counterparty Type": "Customer",
        "Counterparty ID": csvIdentifier("cust-1"),
        "Payment Term": "",
        "Invoice ID": csvIdentifier("inv-1"),
        "Invoice Number": csvIdentifier("INV-001"),
        "Document Type": "Invoice",
        "Due Date": "2026-05-10",
        Currency: "USD",
        "Base Currency": "USD",
        "Current (Base Currency)": "",
        "1-15 (Base Currency)": "",
        "16-45 (Base Currency)": "",
        "46-75 (Base Currency)": "",
        "76+ (Base Currency)": "",
        "Unapplied (Base Currency)": "",
        "Open Amount (Base Currency)": 230,
        "Open Amount (Invoice Currency)": 230,
        "Total Amount (Invoice Currency)": 250,
        "Settled (Invoice Currency)": 20,
        "Exchange Rate (Invoice to Base)": 1
      },
      {
        "As Of Date": "2026-05-31",
        Side: "AR",
        "Aging Method": "documentDate",
        "Bucket Days": "15,45,75",
        "Row Type": "Invoice",
        "Counterparty Type": "Customer",
        "Counterparty ID": csvIdentifier("cust-1"),
        "Payment Term": "",
        "Invoice ID": csvIdentifier("inv-2"),
        "Invoice Number": csvIdentifier("INV-002"),
        "Document Type": "Credit Memo",
        "Due Date": "",
        Currency: "EUR",
        "Base Currency": "USD",
        "Current (Base Currency)": "",
        "1-15 (Base Currency)": "",
        "16-45 (Base Currency)": "",
        "46-75 (Base Currency)": "",
        "76+ (Base Currency)": "",
        "Unapplied (Base Currency)": "",
        "Open Amount (Base Currency)": -55,
        "Open Amount (Invoice Currency)": -50,
        "Total Amount (Invoice Currency)": -50,
        "Settled (Invoice Currency)": 0,
        "Exchange Rate (Invoice to Base)": 1.1
      }
    ]);
  });

  it("uses supplier identity for AP exports and includes ungrouped loaded invoices", () => {
    const rows = buildARAPAgingExportRows({
      side: "ap",
      baseCurrencyCode: "EUR",
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
        "Counterparty ID": csvIdentifier("sup-1"),
        "Payment Term": "",
        "Invoice ID": csvIdentifier("bill-1"),
        "Invoice Number": csvIdentifier("BILL-001"),
        "Document Type": "",
        "Due Date": "2026-06-01",
        Currency: "USD",
        "Base Currency": "EUR",
        "Current (Base Currency)": "",
        "1-30 (Base Currency)": "",
        "31-60 (Base Currency)": "",
        "61-90 (Base Currency)": "",
        "91+ (Base Currency)": "",
        "Unapplied (Base Currency)": "",
        "Open Amount (Base Currency)": 80,
        "Open Amount (Invoice Currency)": 80,
        "Total Amount (Invoice Currency)": 80,
        "Settled (Invoice Currency)": 0,
        "Exchange Rate (Invoice to Base)": 1
      }
    ]);
  });

  it("blocks downloads when either report source query failed", () => {
    expect(canDownloadARAPAgingExport(false, true, 1)).toBe(true);
    expect(canDownloadARAPAgingExport(false, true, 0)).toBe(false);
    expect(canDownloadARAPAgingExport(true, true, 1)).toBe(false);
  });

  it("blocks downloads when a source may be truncated", () => {
    expect(canDownloadARAPAgingExport(false, false, 1)).toBe(false);
  });

  it("preserves exponent-like and date-like invoice identifiers as text", () => {
    const rows = buildARAPAgingExportRows({
      side: "ar",
      baseCurrencyCode: "USD",
      asOfDate: "2026-05-31",
      agingMethod: "documentDate",
      bucketDays: [30, 60, 90],
      aging: [],
      open: [
        {
          invoiceId: "1E10",
          invoiceNumber: "01-02",
          dateDue: null,
          currencyCode: "USD",
          exchangeRate: 1,
          totalAmount: 10,
          settled: 0,
          openInCurrency: 10,
          openInBase: 10,
          customerId: "01-02"
        }
      ]
    });

    expect(serializeCsv(rows)).toContain(",'01-02,,'1E10,'01-02,");
  });

  it("uses supplied localized headers and row labels", () => {
    const rows = buildARAPAgingExportRows({
      side: "ar",
      baseCurrencyCode: "USD",
      asOfDate: "2026-05-31",
      agingMethod: "dueDate",
      bucketDays: [30, 60, 90],
      aging: [
        {
          customerId: "cust-1",
          current: 10,
          bucket1: 0,
          bucket2: 0,
          bucket3: 0,
          bucket4: 0,
          unapplied: 0,
          total: 10
        }
      ],
      open: [],
      labels: {
        asOfDate: "日期",
        rowType: "行类型",
        counterpartyRow: "往来单位",
        counterpartyType: "往来单位类型",
        dueDateMethod: "按到期日"
      }
    });

    expect(rows[0]).toMatchObject({
      日期: "2026-05-31",
      行类型: "往来单位",
      往来单位类型: "Customer",
      "Aging Method": "按到期日"
    });

    const documentDateRows = buildARAPAgingExportRows({
      side: "ar",
      baseCurrencyCode: "USD",
      asOfDate: "2026-05-31",
      agingMethod: "documentDate",
      bucketDays: [30, 60, 90],
      aging: [],
      open: [
        {
          invoiceId: "inv-1",
          invoiceNumber: "INV-001",
          dateDue: null,
          currencyCode: "USD",
          exchangeRate: 1,
          totalAmount: 10,
          settled: 0,
          openInCurrency: 10,
          openInBase: 10,
          customerId: "cust-1"
        }
      ],
      labels: { documentDateMethod: "按单据日" }
    });

    expect(documentDateRows[0]).toHaveProperty("Aging Method", "按单据日");
  });
});
