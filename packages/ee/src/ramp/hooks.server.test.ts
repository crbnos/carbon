import { beforeEach, describe, expect, it, vi } from "vitest";

const getBusiness = vi.hoisted(() => vi.fn());
const getEntities = vi.hoisted(() => vi.fn());
const getRampIntegration = vi.hoisted(() => vi.fn());
const ensureRampConnection = vi.hoisted(() => vi.fn());
const ensureRampWebhook = vi.hoisted(() => vi.fn());
const pushChartOfAccounts = vi.hoisted(() => vi.fn());
const pushCostCenters = vi.hoisted(() => vi.fn());
const trigger = vi.hoisted(() => vi.fn());

vi.mock("@carbon/auth", () => ({ getAppUrl: () => "https://erp.example.com" }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({ role: "service" })
}));
vi.mock("@carbon/jobs", () => ({ trigger }));
vi.mock("./lib/service", () => ({
  clearRampConnectionMetadata: vi.fn(),
  ensureRampConnection,
  ensureRampWebhook,
  getRampIntegration,
  pushChartOfAccounts,
  pushCostCenters
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
    ensureRampWebhook.mockResolvedValue({ webhookId: "webhook-1" });
    pushChartOfAccounts.mockResolvedValue(undefined);
    pushCostCenters.mockResolvedValue(undefined);
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
    expect(trigger).not.toHaveBeenCalled();
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
