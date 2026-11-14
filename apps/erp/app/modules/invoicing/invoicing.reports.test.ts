// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  aggregateSpend,
  agingCsvTable,
  daysPastDue,
  previousPeriod
} from "./invoicing.reports";

describe("previousPeriod", () => {
  it("returns the equal-length window immediately before the range", () => {
    // Jan 1–31 (31 days) → the 31 days before it: Dec 1–31.
    expect(previousPeriod("2026-01-01", "2026-01-31")).toEqual({
      previousStart: "2025-12-01",
      previousEnd: "2025-12-31"
    });
  });

  it("handles a single-day range", () => {
    expect(previousPeriod("2026-03-15", "2026-03-15")).toEqual({
      previousStart: "2026-03-14",
      previousEnd: "2026-03-14"
    });
  });

  it("spans month/year boundaries: previous window ends the day before, same length", () => {
    const start = "2026-02-01";
    const end = "2026-07-31";
    const { previousStart, previousEnd } = previousPeriod(start, end);
    // Ends the day before the range starts...
    expect(previousEnd).toBe("2026-01-31");
    // ...and is exactly as long as the selected range.
    expect(parseDate(previousEnd).compare(parseDate(previousStart))).toBe(
      parseDate(end).compare(parseDate(start))
    );
  });
});

describe("aggregateSpend", () => {
  const start = "2026-01-01";
  const end = "2026-01-31";
  const prevStart = "2025-12-01";
  const prevEnd = "2025-12-31";

  const run = (
    rows: { partyId: string | null; totalAmount: number | null; date: string }[]
  ) => aggregateSpend(rows, start, end, prevStart, prevEnd);

  it("buckets amounts into the current and previous windows", () => {
    const result = run([
      { partyId: "c1", totalAmount: 100, date: "2026-01-10" },
      { partyId: "c1", totalAmount: 50, date: "2026-01-20" },
      { partyId: "c1", totalAmount: 120, date: "2025-12-15" }
    ]);
    expect(result).toEqual([
      { partyId: "c1", total: 150, previousTotal: 120, variance: 25 }
    ]);
  });

  it("marks a party with no prior basis as null variance (new)", () => {
    const result = run([
      { partyId: "c1", totalAmount: 200, date: "2026-01-05" }
    ]);
    expect(result[0]?.variance).toBeNull();
  });

  it("computes a negative variance when spend drops", () => {
    const result = run([
      { partyId: "c1", totalAmount: 40, date: "2026-01-05" },
      { partyId: "c1", totalAmount: 80, date: "2025-12-05" }
    ]);
    expect(result[0]?.variance).toBe(-50);
  });

  it("sorts by current-period total descending", () => {
    const result = run([
      { partyId: "small", totalAmount: 10, date: "2026-01-02" },
      { partyId: "big", totalAmount: 900, date: "2026-01-02" },
      { partyId: "mid", totalAmount: 100, date: "2026-01-02" }
    ]);
    expect(result.map((r) => r.partyId)).toEqual(["big", "mid", "small"]);
  });

  it("drops rows with no party or zero amount, and dates outside both windows", () => {
    const result = run([
      { partyId: null, totalAmount: 500, date: "2026-01-10" },
      { partyId: "c1", totalAmount: 0, date: "2026-01-10" },
      { partyId: "c2", totalAmount: 75, date: "2026-01-10" },
      { partyId: "c2", totalAmount: 999, date: "2025-06-01" } // outside both windows
    ]);
    expect(result).toEqual([
      { partyId: "c2", total: 75, previousTotal: 0, variance: null }
    ]);
  });
});

describe("agingCsvTable", () => {
  const labels = {
    party: "Supplier",
    document: "Document",
    transactionDate: "Transaction Date",
    documentType: "Document Type",
    invoice: "Invoice",
    creditMemo: "Credit Memo",
    debitMemo: "Debit Memo",
    receipt: "Receipt",
    disbursement: "Disbursement",
    supplierInvoiceNumber: "Supplier Invoice Number",
    dueDate: "Due Date",
    originalAmount: "Original Amount",
    daysPastDue: "Days Past Due",
    paymentTerm: "Payment Term",
    current: "Current",
    bucket1: "1-30 Days",
    bucket2: "31-60 Days",
    bucket3: "61-90 Days",
    bucket4: "91+ Days",
    unapplied: "Unapplied",
    total: "Total"
  };
  const aging = [
    {
      partyId: "sup-1",
      paymentTerm: "Net 30",
      current: 0,
      bucket1: 1500,
      bucket2: -500,
      bucket3: 0,
      bucket4: 0,
      unapplied: -250,
      total: 750
    }
  ];
  const open = [
    {
      partyId: "sup-1",
      documentNumber: "PI-123",
      documentType: "Invoice",
      transactionDate: "2026-11-01",
      dateDue: "2026-11-30",
      originalInBase: 2000,
      openInBase: 1500,
      supplierReference: "SUP-9"
    },
    {
      partyId: "sup-1",
      documentNumber: "DR-7",
      documentType: "Debit Memo",
      transactionDate: "2026-11-07",
      dateDue: null,
      originalInBase: -500,
      openInBase: -500,
      supplierReference: null
    }
  ];
  const unappliedPayments = [
    {
      partyId: "sup-1",
      documentNumber: "PAY-3",
      documentType: "Disbursement",
      transactionDate: "2026-12-01",
      dateDue: null,
      originalInBase: -500,
      openInBase: -250
    }
  ];
  const base = () => ({
    labels,
    partyNameById: new Map([["sup-1", "Acme"]]),
    aging,
    open,
    unappliedPayments,
    asOfDate: "2026-12-15",
    agingMethod: "dueDate" as const,
    bucketDays: [30, 60, 90] as [number, number, number],
    withSupplierReference: true
  });

  it("exports one row per document or open payment with the party on each row", () => {
    const { fields, rows } = agingCsvTable(base());
    expect(fields).toEqual([
      "Supplier",
      "Document",
      "Transaction Date",
      "Document Type",
      "Supplier Invoice Number",
      "Due Date",
      "Original Amount",
      "Days Past Due",
      "Payment Term",
      "Current",
      "1-30 Days",
      "31-60 Days",
      "61-90 Days",
      "91+ Days",
      "Unapplied",
      "Total"
    ]);
    expect(rows).toEqual([
      [
        "Acme",
        "PI-123",
        "2026-11-01",
        "Invoice",
        "SUP-9",
        "2026-11-30",
        2000,
        15,
        "Net 30",
        0,
        1500,
        0,
        0,
        0,
        0,
        1500
      ],
      [
        "Acme",
        "DR-7",
        "2026-11-07",
        "Debit Memo",
        "",
        "",
        -500,
        "",
        "Net 30",
        0,
        0,
        -500,
        0,
        0,
        0,
        -500
      ],
      [
        "Acme",
        "PAY-3",
        "2026-12-01",
        "Disbursement",
        "",
        "",
        -500,
        "",
        "Net 30",
        0,
        0,
        0,
        0,
        0,
        -250,
        -250
      ]
    ]);
  });

  it("uses document date for invoice aging when selected", () => {
    const { rows } = agingCsvTable({
      ...base(),
      agingMethod: "documentDate"
    });
    expect(rows[0]?.slice(9, 14)).toEqual([0, 0, 1500, 0, 0]);
    // Memos always age from their memo date.
    expect(rows[1]?.slice(9, 14)).toEqual([0, 0, -500, 0, 0]);
  });

  it("includes zero-net parties and uses localized headings and document types", () => {
    const { fields, rows } = agingCsvTable({
      ...base(),
      labels: {
        ...labels,
        party: "Proveedor",
        documentType: "Belegart",
        invoice: "Rechnung",
        disbursement: "Auszahlung",
        bucket1: "1-30 Tage"
      },
      partyNameById: new Map(),
      aging: [],
      open: [
        { ...open[0]!, openInBase: 500 },
        { ...open[1]!, openInBase: -500 }
      ],
      unappliedPayments: []
    });
    expect(fields[0]).toBe("Proveedor");
    expect(fields[3]).toBe("Belegart");
    expect(fields[10]).toBe("1-30 Tage");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row[0], row[1], row[3]])).toEqual([
      ["sup-1", "PI-123", "Rechnung"],
      ["sup-1", "DR-7", "Debit Memo"]
    ]);
  });

  it("omits the supplier reference column for AR", () => {
    const { fields, rows } = agingCsvTable({
      ...base(),
      withSupplierReference: false,
      labels: { ...labels, party: "Customer" }
    });
    expect(fields[0]).toBe("Customer");
    expect(fields).not.toContain("Supplier Invoice Number");
    expect(rows).toHaveLength(3);
    expect(rows[0]?.[4]).toBe("2026-11-30");
  });

  it("counts only overdue calendar days", () => {
    expect(daysPastDue("2026-12-15", "2026-12-14")).toBe(1);
    expect(daysPastDue("2026-12-15", "2026-12-15")).toBe(0);
    expect(daysPastDue("2026-12-15", "2026-12-16")).toBe(0);
    expect(daysPastDue("2026-12-15", null)).toBeNull();
  });
});
