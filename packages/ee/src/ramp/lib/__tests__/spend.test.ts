import { describe, expect, it, vi } from "vitest";
import type {
  ExternalIntegrationMapping,
  ExternalIntegrationMappingService
} from "../../../accounting/core/external-mapping";
import { RampApiError, type RampClient, RampRateLimitError } from "../client";
import { archiveRampBillForInvoice } from "../spend";

const mappingRow: ExternalIntegrationMapping = {
  id: "mapping-1",
  entityType: "bill",
  entityId: "invoice-1",
  integration: "ramp",
  externalId: "ramp-bill-1",
  allowDuplicateExternalId: false,
  companyId: "company-1",
  metadata: { rampPaid: true },
  lastSyncedAt: null,
  remoteUpdatedAt: null,
  createdAt: "2026-09-11T00:00:00Z",
  updatedAt: "2026-09-11T00:00:00Z",
  createdBy: "user-1"
};

describe("archiveRampBillForInvoice", () => {
  it.each([
    new TypeError("fetch failed"),
    new RampApiError(401, "UNAUTHORIZED", "Invalid credentials"),
    new RampApiError(403, "FORBIDDEN", "Missing bills:write scope"),
    new RampApiError(500, "SERVER_ERROR", "Internal server error"),
    new RampRateLimitError(30),
    new RampApiError(404, "NOT_FOUND", "Bill not found"),
    new RampApiError(400, "UNKNOWN", "Bill may already be paid or archived")
  ])("preserves retry eligibility after $name: $message", async (error) => {
    const link = vi.fn();
    const archiveBill = vi.fn().mockRejectedValue(error);

    await expect(
      archiveRampBillForInvoice(
        { link } as unknown as ExternalIntegrationMappingService,
        { archiveBill } as unknown as RampClient,
        mappingRow
      )
    ).rejects.toBe(error);

    expect(link).not.toHaveBeenCalled();
  });

  it("stamps archived only after provider confirmation and preserves metadata", async () => {
    const link = vi.fn();
    const archiveBill = vi.fn(async () => {
      expect(link).not.toHaveBeenCalled();
    });

    await archiveRampBillForInvoice(
      { link } as unknown as ExternalIntegrationMappingService,
      { archiveBill } as unknown as RampClient,
      mappingRow
    );

    expect(archiveBill).toHaveBeenCalledWith("ramp-bill-1");
    expect(link).toHaveBeenCalledExactlyOnceWith(
      "bill",
      "invoice-1",
      "ramp",
      "ramp-bill-1",
      { createdBy: "user-1", metadata: { rampPaid: true, archived: true } }
    );
  });
});
