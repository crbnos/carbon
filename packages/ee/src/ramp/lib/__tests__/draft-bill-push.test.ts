import { describe, expect, it, vi } from "vitest";
import type { CostingLine } from "../../../accounting/core/document-costing";
import type { ExternalIntegrationMappingService } from "../../../accounting/core/external-mapping";
import type { RampClient } from "../client";
import { pushInvoiceDraftBill } from "../spend";

// The GL coding comes from the POSTED journal (loadBillCostingLines), not the
// invoice line — so the unit test controls the costing result and asserts how
// pushInvoiceDraftBill turns it into a coded draft bill.
const { loadBillCostingLines, toTransactionCurrencyLines } = vi.hoisted(() => ({
  loadBillCostingLines: vi.fn(),
  toTransactionCurrencyLines: vi.fn()
}));
vi.mock("../../../accounting/core/document-costing", () => ({
  loadBillCostingLines,
  toTransactionCurrencyLines
}));

describe("pushInvoiceDraftBill (draft-only, coded from the posted journal)", () => {
  const supplier = {
    id: "supplier-1",
    name: "Test Supplier",
    country: "US",
    contact: null,
    address: null
  };
  const invoice = {
    id: "invoice-1",
    readableId: "AP-1",
    supplierReference: "Vendor-Ref-1",
    dateIssued: "2026-09-11",
    dateDue: "2026-09-30",
    supplier
  };
  const db = {} as never; // never touched — loadBillCostingLines is mocked

  const costingLines: CostingLine[] = [
    {
      id: "jl_1",
      accountId: "acct_expense",
      amount: 12.34,
      description: "Coded expense",
      dimensions: [{ dimensionId: "dim_cc", valueId: "cc_ga" }]
    },
    {
      id: "jl_2",
      accountId: "acct_unpushed",
      amount: 5,
      description: "Uncoded expense (account not pushed to Ramp)",
      dimensions: []
    }
  ];

  it("creates a coded draft from costing lines, does not submit, maps the draft id", async () => {
    loadBillCostingLines.mockResolvedValue({
      lines: costingLines,
      currencyCode: "USD",
      exchangeRate: 1,
      documentTotal: 17.34,
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      postingDate: "2026-09-11"
    });
    // Identity conversion — the base amounts are already the document amounts.
    toTransactionCurrencyLines.mockImplementation(
      (lines: CostingLine[]) => lines
    );

    const getExternalId = vi.fn(async () => "ramp-vendor-1");
    const link = vi.fn();
    const createDraftBill = vi.fn(
      async (_body: Record<string, any>, _key?: string) => ({ id: "draft-1" })
    );
    const submitDraftBill = vi.fn(async () => ({ id: "bill-1" }));

    const outcome = await pushInvoiceDraftBill(
      db,
      "company-1",
      { getExternalId, link } as unknown as ExternalIntegrationMappingService,
      { createDraftBill, submitDraftBill } as unknown as RampClient,
      invoice,
      {
        pushedAccountIds: new Set(["acct_expense"]),
        pushedCostCenterIds: new Set(["cc_ga"]),
        pushedProjectIds: new Set<string>()
      }
    );

    expect(outcome).toBe("pushed");
    expect(submitDraftBill).not.toHaveBeenCalled();
    expect(loadBillCostingLines).toHaveBeenCalledWith(db, {
      companyId: "company-1",
      billId: "invoice-1"
    });

    const [body] = createDraftBill.mock.calls[0]!;
    expect(body).toMatchObject({
      vendor_id: "ramp-vendor-1",
      invoice_number: "Vendor-Ref-1",
      invoice_currency: "USD",
      issued_at: "2026-09-11",
      due_at: "2026-09-30",
      remote_id: "invoice-1"
    });
    // Ramp 422s enable_accounting_sync:false alongside remote_id — must be absent.
    expect("enable_accounting_sync" in body).toBe(false);

    // Line 1: GL account (native "Category") + cost center (from the dimension).
    expect(body.line_items[0]).toEqual({
      memo: "Coded expense",
      amount: 12.34,
      accounting_field_selections: [
        {
          field_external_id: "Category",
          field_option_external_id: "acct_expense"
        },
        {
          field_external_id: "carbon-cost-center",
          field_option_external_id: "cc_ga"
        }
      ]
    });
    // Line 2: account not pushed to Ramp → uncoded, never 422s.
    expect(body.line_items[1]).toEqual({
      memo: "Uncoded expense (account not pushed to Ramp)",
      amount: 5,
      accounting_field_selections: []
    });

    expect(link).toHaveBeenCalledWith("bill", "invoice-1", "ramp", "draft-1", {
      createdBy: "system"
    });
  });

  it("skips a supplier with no name (no Ramp vendor possible) before reading costing", async () => {
    loadBillCostingLines.mockClear();
    const getExternalId = vi.fn(async () => undefined);
    const link = vi.fn();
    const createDraftBill = vi.fn(async () => ({ id: "draft-1" }));

    const outcome = await pushInvoiceDraftBill(
      db,
      "company-1",
      { getExternalId, link } as unknown as ExternalIntegrationMappingService,
      { createDraftBill } as unknown as RampClient,
      { ...invoice, supplier: { ...supplier, name: null } },
      {
        pushedAccountIds: new Set<string>(),
        pushedCostCenterIds: new Set<string>(),
        pushedProjectIds: new Set<string>()
      }
    );

    expect(outcome).toBe("skipped");
    expect(loadBillCostingLines).not.toHaveBeenCalled();
    expect(createDraftBill).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
  });
});
