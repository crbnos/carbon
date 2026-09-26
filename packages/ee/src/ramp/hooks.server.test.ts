import { beforeEach, describe, expect, it, vi } from "vitest";

const getBusiness = vi.hoisted(() => vi.fn());
const getEntities = vi.hoisted(() => vi.fn());
const getRampIntegration = vi.hoisted(() => vi.fn());
const ensureRampConnection = vi.hoisted(() => vi.fn());
const ensureRampWebhook = vi.hoisted(() => vi.fn());
const pushChartOfAccounts = vi.hoisted(() => vi.fn());
const pushCostCenters = vi.hoisted(() => vi.fn());
const pushProjects = vi.hoisted(() => vi.fn());
const trigger = vi.hoisted(() => vi.fn());
const ensureProviderSubscriptions = vi.hoisted(() => vi.fn());

vi.mock("@carbon/auth", () => ({ getAppUrl: () => "https://erp.example.com" }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({ role: "service" })
}));
vi.mock("@carbon/jobs", () => ({ trigger }));
// The convergence itself is covered by subscriptions-mapping.test.ts; here it
// is stubbed so these tests need no Supabase RPC fake.
vi.mock("../accounting/core/subscriptions", () => ({
  ensureProviderSubscriptions
}));
vi.mock("./lib/service", () => ({
  clearRampConnectionMetadata: vi.fn(),
  ensureRampConnection,
  ensureRampWebhook,
  getRampIntegration,
  pushChartOfAccounts,
  pushCostCenters,
  pushProjects
}));

import { rampOnInstall, rampOnUpdate } from "./hooks.server";

const credentials = {
  type: "oauth2" as const,
  accessToken: "access-token",
  environment: "production" as const
};

function integration(metadata: Record<string, unknown>) {
  return {
    client: { getBusiness, getEntities },
    metadata: { credentials, sync: {}, ...metadata }
  };
}

describe("Ramp install convergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBusiness.mockResolvedValue({ id: "business-1" });
    getEntities.mockResolvedValue({ data: [{ id: "entity-1" }] });
    ensureRampConnection.mockResolvedValue({ connectionId: "connection-1" });
    ensureProviderSubscriptions.mockResolvedValue({ ensured: [], removed: [] });
    ensureRampWebhook.mockResolvedValue({ webhookId: "webhook-1" });
    pushChartOfAccounts.mockResolvedValue(undefined);
    pushCostCenters.mockResolvedValue(undefined);
    pushProjects.mockResolvedValue(undefined);
    trigger.mockResolvedValue(undefined);
  });

  it("connects OAuth without pushing or launching finance before account setup", async () => {
    getRampIntegration.mockResolvedValue(integration({}));

    await rampOnInstall("company-1");

    expect(getBusiness).toHaveBeenCalledOnce();
    expect(ensureRampConnection).toHaveBeenCalledOnce();
    expect(ensureRampWebhook).toHaveBeenCalledOnce();
    expect(pushChartOfAccounts).not.toHaveBeenCalled();
    expect(pushCostCenters).not.toHaveBeenCalled();
    expect(pushProjects).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it("claims no connection and pushes no coding masters in push-only", async () => {
    // The whole point of the mode. Every one of these is an `accounting:write`
    // call, and Ramp permits exactly ONE connected accounting provider — making
    // any of them would take the seat the customer's other system holds.
    getRampIntegration.mockResolvedValue(
      integration({
        syncMode: "push-only",
        cardLiabilityAccountId: "account-1"
      })
    );

    await rampOnInstall("company-1");

    expect(ensureRampConnection).not.toHaveBeenCalled();
    expect(pushChartOfAccounts).not.toHaveBeenCalled();
    expect(pushCostCenters).not.toHaveBeenCalled();
    expect(pushProjects).not.toHaveBeenCalled();
  });

  it("still registers the webhook and launches the sync in push-only", async () => {
    // Push-only has plenty to do — purchase orders, receipts, provisional bills,
    // and pulling bill payments back — so gating the coding masters must not
    // gate the integration itself.
    getRampIntegration.mockResolvedValue(
      integration({
        syncMode: "push-only",
        cardLiabilityAccountId: "account-1"
      })
    );

    await rampOnInstall("company-1");

    expect(ensureRampWebhook).toHaveBeenCalledOnce();
    expect(trigger).toHaveBeenCalledOnce();
  });

  it("converges normally in provider mode", async () => {
    getRampIntegration.mockResolvedValue(
      integration({ syncMode: "provider", cardLiabilityAccountId: "account-1" })
    );

    await rampOnInstall("company-1");

    expect(ensureRampConnection).toHaveBeenCalledOnce();
    expect(pushChartOfAccounts).toHaveBeenCalledOnce();
  });

  it("treats an install with no stored mode as provider", async () => {
    // Every install predating modes must keep claiming its connection.
    getRampIntegration.mockResolvedValue(
      integration({ cardLiabilityAccountId: "account-1" })
    );

    await rampOnInstall("company-1");

    expect(ensureRampConnection).toHaveBeenCalledOnce();
    expect(pushChartOfAccounts).toHaveBeenCalledOnce();
  });

  it("subscribes Ramp to the sync event system on install", async () => {
    // Without this the PO/bill push is silently dead: the event handler is
    // never told there is a spend provider to enqueue for.
    getRampIntegration.mockResolvedValue(
      integration({ cardLiabilityAccountId: "account-1" })
    );

    await rampOnInstall("company-1");

    expect(ensureProviderSubscriptions).toHaveBeenCalledWith(
      expect.anything(),
      "company-1",
      "ramp"
    );
  });

  it("converges master data and launches sync after required settings are saved", async () => {
    getRampIntegration.mockResolvedValue(
      integration({
        cardLiabilityAccountId: "liability-1",
        statementBankAccountId: "bank-1",
        entityId: "entity-1"
      })
    );

    await rampOnUpdate("company-1");

    expect(getEntities).toHaveBeenCalledOnce();
    expect(pushChartOfAccounts).toHaveBeenCalledOnce();
    expect(pushCostCenters).toHaveBeenCalledOnce();
    expect(pushProjects).toHaveBeenCalledOnce();
    expect(trigger).toHaveBeenCalledWith("ramp-sync", {
      companyId: "company-1",
      reason: "settings-update"
    });
  });

  it("rejects a configured entity that the connected Ramp business does not own", async () => {
    getRampIntegration.mockResolvedValue(
      integration({
        cardLiabilityAccountId: "liability-1",
        statementBankAccountId: "bank-1",
        entityId: "entity-other"
      })
    );

    await expect(rampOnUpdate("company-1")).rejects.toThrow(
      "Ramp entity entity-other is not available"
    );

    expect(pushChartOfAccounts).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });
});
