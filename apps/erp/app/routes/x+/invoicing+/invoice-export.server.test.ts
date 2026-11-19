// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  invoiceCsvResponse,
  invoiceExcelResponse
} from "./invoice-export.server";

const table = {
  columns: [
    { key: "invoiceId", label: "Invoice Number" },
    { key: "customerId", label: "Customer" },
    { key: "dateDue", label: "Due Date" },
    { key: "invoiceTotal", label: "Total" }
  ],
  rows: [["INV-1", '=HYPERLINK("bad")', "2026-11-14", 125.5]]
};

describe("invoice export responses", () => {
  it("writes an injection-safe CSV with the selected headers", async () => {
    const response = invoiceCsvResponse("sales-invoices.csv", table);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    const csv = await response.text();
    expect(csv).toContain("HYPERLINK");
    expect(csv).not.toContain("=HYPERLINK");
  });

  it("writes a readable workbook with typed date and amount cells", async () => {
    const response = await invoiceExcelResponse(
      "sales-invoices.xlsx",
      table,
      "sales"
    );
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      Buffer.from(await response.arrayBuffer()) as unknown as Parameters<
        typeof workbook.xlsx.load
      >[0]
    );
    const sheet = workbook.getWorksheet("Sales Invoices");
    expect(sheet?.getRow(1).values).toContain("Customer");
    expect(sheet?.getCell("B2").value).toBe('=HYPERLINK("bad")');
    expect(sheet?.getCell("C2").numFmt).toBe("yyyy-mm-dd");
    expect(sheet?.getCell("C2").value).toBeTruthy();
    expect(sheet?.getCell("D2").value).toBe(125.5);
    expect(sheet?.getCell("D2").numFmt).toBe("#,##0.00;[Red](#,##0.00)");
  });
});
