import { beforeEach, describe, expect, it, vi } from "vitest";

const getCarbonServiceRole = vi.hoisted(() => vi.fn());
const patchRampSettings = vi.hoisted(() => vi.fn());

vi.mock("@carbon/auth/auth.server", () => ({ bustApiKeyCache: vi.fn() }));
vi.mock("@carbon/auth/client.server", () => ({ getCarbonServiceRole }));
vi.mock("@carbon/ee", () => ({
  getIntegrationConfigById: vi.fn(),
  resolveIntegrationSecrets: vi.fn(),
  splitSecrets: vi.fn(() => ({ config: {}, secrets: {} }))
}));
vi.mock("@carbon/ee/hooks.server", () => ({
  getIntegrationServerHooks: vi.fn()
}));
vi.mock("@carbon/ee/ramp.server", () => ({ patchRampSettings }));
vi.mock("@carbon/kv", () => ({
  redis: {
    del: vi.fn(),
    keys: vi.fn(() => Promise.resolve([])),
    pipeline: vi.fn()
  }
}));

import { upsertCompanyIntegration } from "./settings.server";

describe("Ramp settings persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCarbonServiceRole.mockReturnValue({ role: "service" });
    patchRampSettings.mockResolvedValue({ id: "ramp", metadata: {} });
  });

  it("routes Ramp settings through the atomic key-owned patch", async () => {
    const awaitableSingle = Promise.resolve({
      data: { id: "ramp", metadata: {} },
      error: null
    });
    const from = vi.fn(() => ({
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({ single: vi.fn(() => awaitableSingle) }))
      }))
    }));
    const userClient = {
      from
    };

    const result = await upsertCompanyIntegration(userClient as never, {
      id: "ramp",
      active: true,
      companyId: "company-1",
      updatedBy: "user-1",
      metadata: {
        cardLiabilityAccountId: "account-card",
        connectionId: "stale-connection"
      }
    });

    expect(patchRampSettings).toHaveBeenCalledWith(
      { role: "service" },
      "company-1",
      expect.objectContaining({
        active: true,
        updatedBy: "user-1"
      })
    );
    expect(from).not.toHaveBeenCalled();
    expect(result.error).toBeNull();
  });
});
