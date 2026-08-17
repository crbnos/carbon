import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  parseStoredCredentials: (raw: unknown) => raw,
  ProviderID: { QUICKBOOKS: "quickbooks" },
  // Faithful minimal version of the real helper: first LinkedTxn of the
  // family's TxnType → canonical composite.
  buildQboPaymentSyncChange: (
    remote: {
      Id: string;
      Line?: Array<{ LinkedTxn?: Array<{ TxnId: string; TxnType: string }> }>;
    },
    family: "ar" | "ap"
  ) => {
    const txnType = family === "ap" ? "Bill" : "Invoice";
    for (const line of remote.Line ?? []) {
      for (const linked of line.LinkedTxn ?? []) {
        if (linked.TxnType === txnType) {
          return {
            documentRemoteId: linked.TxnId,
            entityId:
              family === "ap"
                ? `bill:${linked.TxnId}:${remote.Id}`
                : `${linked.TxnId}:${remote.Id}`
          };
        }
      }
    }
    return null;
  }
}));

import { trigger } from "@carbon/jobs";
import { action } from "./webhook.quickbooks.$companyId";

const TOKEN = "verifier-secret";

function makeRequest(
  bodyObj: unknown,
  opts: { token?: string | null; signature?: string } = {}
) {
  const body = JSON.stringify(bodyObj);
  const headers = new Headers();
  if (opts.signature !== undefined) {
    headers.set("intuit-signature", opts.signature);
  } else if (opts.token !== null) {
    const sig = createHmac("sha256", opts.token ?? TOKEN)
      .update(body)
      .digest("base64");
    headers.set("intuit-signature", sig);
  }
  return new Request("http://localhost/api/webhook/quickbooks/company-1", {
    method: "POST",
    body,
    headers
  });
}

function run(request: Request) {
  return action({ request, params: { companyId: "company-1" } } as never);
}

const billPaymentEvent = {
  eventNotifications: [
    {
      realmId: "realm-1",
      dataChangeEvent: {
        entities: [
          { name: "BillPayment", id: "bp-1", operation: "Update" },
          { name: "Vendor", id: "v-1", operation: "Update" }
        ]
      }
    }
  ]
};

describe("webhook.quickbooks payment accelerator", () => {
  beforeEach(() => {
    vi.mocked(trigger).mockReset();
    getAccountingIntegration.mockReset();
    getProviderIntegration.mockReset();

    getAccountingIntegration.mockResolvedValue({
      active: true,
      metadata: {
        credentials: {
          type: "oauth2",
          providerMetadata: { webhookVerifierToken: TOKEN }
        }
      }
    });
    getProviderIntegration.mockReturnValue({
      getBillPayment: async (id: string) => ({
        Id: id,
        TotalAmt: 500,
        Line: [
          { Amount: 500, LinkedTxn: [{ TxnId: "bill-9", TxnType: "Bill" }] }
        ]
      }),
      getPayment: async (id: string) => ({
        Id: id,
        TotalAmt: 125,
        Line: [
          { Amount: 125, LinkedTxn: [{ TxnId: "inv-7", TxnType: "Invoice" }] }
        ]
      })
    });
  });

  it("verifies a valid intuit-signature and enqueues the AP composite; ignores non-payment entities", async () => {
    const result = (await run(makeRequest(billPaymentEvent))) as {
      success: boolean;
    };
    expect(result.success).toBe(true);

    expect(trigger).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(trigger).mock.calls[0]?.[1] as {
      companyId: string;
      provider: string;
      syncType: string;
      syncDirection: string;
      entities: Array<{
        entityType: string;
        entityId: string;
        operation: string;
      }>;
    };
    expect(payload).toMatchObject({
      companyId: "company-1",
      provider: "quickbooks",
      syncType: "webhook",
      syncDirection: "pull-from-accounting"
    });
    // Vendor is ignored; only the BillPayment is enqueued (AP `bill:` composite).
    expect(payload.entities).toEqual([
      {
        entityType: "payment",
        entityId: "bill:bill-9:bp-1",
        operation: "update"
      }
    ]);
  });

  it("enqueues the prefix-less AR composite for a Payment", async () => {
    await run(
      makeRequest({
        eventNotifications: [
          {
            dataChangeEvent: {
              entities: [{ name: "Payment", id: "pay-1", operation: "Update" }]
            }
          }
        ]
      })
    );

    const payload = vi.mocked(trigger).mock.calls[0]?.[1] as {
      entities: Array<{ entityType: string; entityId: string }>;
    };
    expect(payload.entities).toEqual([
      { entityType: "payment", entityId: "inv-7:pay-1", operation: "update" }
    ]);
  });

  it("acks and ignores a payload with no payment entities", async () => {
    const result = (await run(
      makeRequest({
        eventNotifications: [
          {
            dataChangeEvent: {
              entities: [{ name: "Customer", id: "c-1", operation: "Update" }]
            }
          }
        ]
      })
    )) as { success: boolean; ignored?: boolean };
    expect(result).toEqual({ success: true, ignored: true });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature with 401 and does not enqueue", async () => {
    const result = (await run(
      makeRequest(billPaymentEvent, { signature: "not-a-valid-signature" })
    )) as { init?: { status?: number } };
    expect(result.init?.status).toBe(401);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("returns 401 when no verifier token is configured", async () => {
    getAccountingIntegration.mockResolvedValue({
      active: true,
      metadata: { credentials: { type: "oauth2", providerMetadata: {} } }
    });
    const original = process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN;
    delete process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN;

    const result = (await run(
      makeRequest(billPaymentEvent, { token: null })
    )) as {
      init?: { status?: number };
    };
    expect(result.init?.status).toBe(401);
    expect(trigger).not.toHaveBeenCalled();

    if (original !== undefined) {
      process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN = original;
    }
  });
});
