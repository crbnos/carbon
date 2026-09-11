import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { ExternalIntegrationMappingService } from "../../../accounting/core/external-mapping";
import type { RampClient } from "../client";
import { pushInvoiceDraftBill } from "../spend";

describe("unverified Ramp draft-bill contract gate", () => {
  it.each([
    "Test Supplier",
    null
  ])("blocks export before any side effect for supplier %s", async (name) => {
    const getExternalId = vi.fn(async () => "ramp-vendor-1");
    const link = vi.fn();
    const createDraftBill = vi.fn(async () => ({ id: "draft-1" }));
    const submitDraftBill = vi.fn(async () => ({ id: "bill-1" }));
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: null, error: null })
    };
    const from = vi.fn(() => query);

    await expect(
      pushInvoiceDraftBill(
        { from } as unknown as SupabaseClient<Database>,
        "company-1",
        { getExternalId, link } as unknown as ExternalIntegrationMappingService,
        { createDraftBill, submitDraftBill } as unknown as RampClient,
        {
          id: "invoice-1",
          readableId: "AP-1",
          supplierReference: "Vendor-1",
          currencyCode: "USD",
          dateIssued: "2026-09-11",
          dateDue: "2026-09-30",
          lines: [{ description: "Expense", amount: 12.34 }],
          supplier: {
            id: "supplier-1",
            name,
            country: "US",
            contact: null,
            address: null
          }
        }
      )
    ).rejects.toThrow(
      "Ramp draft-bill export is disabled until its API contract is verified"
    );

    expect(getExternalId).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(createDraftBill).not.toHaveBeenCalled();
    expect(submitDraftBill).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
  });
});
