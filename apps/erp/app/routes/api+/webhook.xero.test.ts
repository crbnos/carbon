import { beforeEach, describe, expect, it, vi } from "vitest";

// Fail-open: no secret configured → signature verification is skipped.
vi.mock("@carbon/auth", () => ({ XERO_WEBHOOK_SECRET: undefined }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({})
}));
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn() }));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warning: vi.fn() })
}));

const getAccountingIntegration = vi.fn();
const getProviderIntegration = vi.fn();
vi.mock("@carbon/ee/accounting", () => ({
  getAccountingIntegration: (...args: unknown[]) =>
    getAccountingIntegration(...args),
  getProviderIntegration: (...args: unknown[]) =>
    getProviderIntegration(...args),
  ProviderID: { XERO: "xero" },
  // Real composite-id shape (the syncer's contract): ACCREC prefix-less AR,
  // ACCPAY `bill:`-prefixed AP.
  getXeroPaymentSyncEntityId: (
    invoiceRemoteId: string,
    paymentRemoteId: string
  ) => `${invoiceRemoteId}:${paymentRemoteId}`,
  getXeroBillPaymentSyncEntityId: (
    invoiceRemoteId: string,
    paymentRemoteId: string
  ) => `bill:${invoiceRemoteId}:${paymentRemoteId}`
}));

import { trigger } from "@carbon/jobs";
import { action } from "./webhook.xero";

function invoiceEvent() {
  return {
    events: [
      {
        tenantId: "tenant-1",
        eventCategory: "INVOICE",
        eventType: "UPDATE",
        resourceId: "inv-remote-1",
        eventDateUtc: "2026-08-01T00:00:00Z"
      }
    ],
    firstEventSequence: 0,
    lastEventSequence: 0
  };
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/webhook/xero", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

describe("webhook.xero Invoice-update payment accelerator", () => {
  beforeEach(() => {
    vi.mocked(trigger).mockReset();
    getAccountingIntegration.mockReset();
    getProviderIntegration.mockReset();

    getAccountingIntegration.mockResolvedValue({
      companyId: "company-1",
      metadata: {}
    });
  });

  it("enqueues a payment op per Payments[] entry for an ACCPAY invoice (bill: ids)", async () => {
    getProviderIntegration.mockReturnValue({
      request: vi.fn().mockResolvedValue({
        error: false,
        data: {
          Invoices: [
            {
              Type: "ACCPAY",
              Payments: [{ PaymentID: "pay-1" }, { PaymentID: "pay-2" }]
            }
          ]
        }
      })
    });

    const result = (await action({
      request: makeRequest(invoiceEvent())
    } as never)) as { success: boolean; jobsTriggered: number };

    expect(result.success).toBe(true);
    expect(result.jobsTriggered).toBe(1);

    expect(trigger).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(trigger).mock.calls[0]?.[1] as {
      entities: Array<{
        entityType: string;
        entityId: string;
        operation: string;
      }>;
    };

    expect(payload.entities).toEqual([
      { entityType: "bill", entityId: "inv-remote-1", operation: "update" },
      {
        entityType: "payment",
        entityId: "bill:inv-remote-1:pay-1",
        operation: "update"
      },
      {
        entityType: "payment",
        entityId: "bill:inv-remote-1:pay-2",
        operation: "update"
      }
    ]);
  });

  it("uses prefix-less AR ids for an ACCREC invoice payment", async () => {
    getProviderIntegration.mockReturnValue({
      request: vi.fn().mockResolvedValue({
        error: false,
        data: {
          Invoices: [{ Type: "ACCREC", Payments: [{ PaymentID: "pay-9" }] }]
        }
      })
    });

    await action({ request: makeRequest(invoiceEvent()) } as never);

    const payload = vi.mocked(trigger).mock.calls[0]?.[1] as {
      entities: Array<{ entityType: string; entityId: string }>;
    };
    expect(payload.entities).toEqual([
      { entityType: "invoice", entityId: "inv-remote-1", operation: "update" },
      {
        entityType: "payment",
        entityId: "inv-remote-1:pay-9",
        operation: "update"
      }
    ]);
  });

  it("enqueues only the document entity when the invoice has no payments", async () => {
    getProviderIntegration.mockReturnValue({
      request: vi.fn().mockResolvedValue({
        error: false,
        data: { Invoices: [{ Type: "ACCPAY", Payments: [] }] }
      })
    });

    await action({ request: makeRequest(invoiceEvent()) } as never);

    const payload = vi.mocked(trigger).mock.calls[0]?.[1] as {
      entities: Array<{ entityType: string }>;
    };
    expect(payload.entities).toEqual([
      { entityType: "bill", entityId: "inv-remote-1", operation: "update" }
    ]);
  });
});
