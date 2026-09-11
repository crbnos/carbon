import { describe, expect, it, vi } from "vitest";
import {
  clearRampConnectionState,
  patchRampConnection,
  patchRampCursor,
  patchRampOAuthCredentials,
  patchRampRefreshedTokens,
  patchRampSettings,
  patchRampWebhook
} from "../state";

function rpcClient() {
  const rpc = vi.fn((_fn: string, _args: Record<string, unknown>) =>
    Promise.resolve({ data: { id: "ramp", metadata: {} }, error: null })
  );
  return { client: { rpc } as never, rpc };
}

describe("Ramp integration state patches", () => {
  it("lets settings update only settings-owned keys", async () => {
    const { client, rpc } = rpcClient();

    await patchRampSettings(client, "company-1", {
      metadata: {
        cardLiabilityAccountId: "account-card",
        statementBankAccountId: "account-bank",
        cashbackIncomeAccountId: "",
        reimbursementBankAccountId: "account-reimbursements",
        codingAccountScope: "expense",
        entityId: "",
        pullTransactions: "false",
        pullBills: "true",
        pullReimbursements: "true",
        pushPurchaseOrders: "false",
        pushInvoices: "true",
        connectionId: "stale-connection",
        webhookId: "stale-webhook",
        credentials: { accessToken: "stale-token" },
        cursors: { repaymentsRepaidAt: "stale-cursor" }
      },
      active: true,
      updatedBy: "user-1"
    });

    expect(rpc).toHaveBeenCalledWith(
      "upsert_company_integration_patch",
      expect.objectContaining({
        p_metadata_patch: {
          cardLiabilityAccountId: "account-card",
          statementBankAccountId: "account-bank",
          reimbursementBankAccountId: "account-reimbursements",
          codingAccountScope: "expense",
          pullTransactions: "false",
          pullBills: "true",
          pullReimbursements: "true",
          pushPurchaseOrders: "false",
          pushInvoices: "true"
        },
        p_metadata_remove: ["entityId", "cashbackIncomeAccountId"],
        p_secret_patch: {},
        p_secret_remove: [],
        p_active: true,
        p_updated_by: "user-1"
      })
    );
  });

  it("patches OAuth credentials without replacing settings or runtime identifiers", async () => {
    const { client, rpc } = rpcClient();

    await patchRampOAuthCredentials(client, "company-1", {
      credentials: {
        type: "oauth2",
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: "2026-09-11T13:00:00.000Z",
        environment: "production"
      },
      updatedBy: "user-1"
    });

    expect(rpc).toHaveBeenCalledWith(
      "upsert_company_integration_patch",
      expect.objectContaining({
        p_metadata_patch: {
          "credentials.type": "oauth2",
          "credentials.expiresAt": "2026-09-11T13:00:00.000Z",
          "credentials.environment": "production"
        },
        p_secret_patch: {
          "credentials.accessToken": "access-1",
          "credentials.refreshToken": "refresh-1"
        },
        p_metadata_remove: ["credentials.clientId"],
        p_secret_remove: ["credentials.clientSecret"],
        p_active: true,
        p_updated_by: "user-1"
      })
    );
  });

  it("clears stale optional OAuth fields when the new grant omits them", async () => {
    const { client, rpc } = rpcClient();

    await patchRampOAuthCredentials(client, "company-1", {
      credentials: {
        type: "oauth2",
        accessToken: "access-1",
        environment: "production"
      },
      updatedBy: "user-1"
    });

    expect(rpc).toHaveBeenCalledWith(
      "upsert_company_integration_patch",
      expect.objectContaining({
        p_metadata_patch: {
          "credentials.type": "oauth2",
          "credentials.environment": "production"
        },
        p_metadata_remove: ["credentials.clientId", "credentials.expiresAt"],
        p_secret_remove: [
          "credentials.clientSecret",
          "credentials.refreshToken"
        ]
      })
    );
  });

  it("patches refreshed tokens, connection, webhook, and cursors by owned path", async () => {
    const { client, rpc } = rpcClient();

    await patchRampRefreshedTokens(client, "company-1", {
      accessToken: "access-2",
      expiresAt: "2026-09-11T14:00:00.000Z"
    });
    await patchRampConnection(client, "company-1", "connection-1");
    await patchRampWebhook(client, "company-1", {
      webhookId: "webhook-1",
      webhookSecret: "secret-1"
    });
    await patchRampCursor(
      client,
      "company-1",
      "invoicePushUpdatedAt",
      "2026-09-11T15:00:00.000Z"
    );

    expect(rpc.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({
        p_metadata_patch: {
          "credentials.expiresAt": "2026-09-11T14:00:00.000Z"
        },
        p_secret_patch: { "credentials.accessToken": "access-2" }
      }),
      expect.objectContaining({
        p_metadata_patch: { connectionId: "connection-1" }
      }),
      expect.objectContaining({
        p_metadata_patch: { webhookId: "webhook-1" },
        p_secret_patch: { webhookSecret: "secret-1" }
      }),
      expect.objectContaining({
        p_metadata_patch: {
          "cursors.invoicePushUpdatedAt": "2026-09-11T15:00:00.000Z"
        }
      })
    ]);
  });

  it("clears only connection-owned identifiers and the webhook secret", async () => {
    const { client, rpc } = rpcClient();

    await clearRampConnectionState(client, "company-1");

    expect(rpc).toHaveBeenCalledWith(
      "upsert_company_integration_patch",
      expect.objectContaining({
        p_metadata_remove: ["connectionId", "webhookId"],
        p_secret_remove: ["webhookSecret"]
      })
    );
  });
});
