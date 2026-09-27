import { issueOAuthState } from "@carbon/auth/oauth-state.server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermissions = vi.hoisted(() => vi.fn());
const getCarbonServiceRole = vi.hoisted(() =>
  vi.fn(() => ({ role: "service" }))
);
const exchangeRampOAuthCode = vi.hoisted(() => vi.fn());
const patchRampOAuthCredentials = vi.hoisted(() => vi.fn());
const rampOnInstall = vi.hoisted(() => vi.fn());

vi.mock("@carbon/auth", () => ({
  CARBON_API_URL: "https://api.example.com",
  SUPABASE_URL: "http://localhost",
  getAppUrl: () => "https://erp.example.com",
  getMESUrl: () => "https://mes.example.com"
}));
vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions }));
vi.mock("@carbon/auth/client.server", () => ({ getCarbonServiceRole }));
vi.mock("@carbon/ee", () => ({ Ramp: { id: "ramp" } }));
vi.mock("@carbon/ee/ramp/hooks.server", () => ({ rampOnInstall }));
vi.mock("@carbon/ee/ramp.server", () => ({
  exchangeRampOAuthCode,
  patchRampOAuthCredentials
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), info: vi.fn(), warning: vi.fn() })
}));
vi.mock("~/modules/settings/integration-errors", () => ({
  integrationErrorSearch: (integration: string, error: string) =>
    `?integration=${integration}&error=${error}`
}));
vi.mock("~/modules/shared", () => ({
  oAuthCallbackSchema: {
    safeParse(value: Record<string, unknown>) {
      return typeof value.code === "string" && typeof value.state === "string"
        ? {
            success: true as const,
            data: value as { code: string; state: string }
          }
        : { success: false as const };
    }
  }
}));

import { loader } from "./integrations.ramp.oauth";

const identity = {
  integrationId: "ramp",
  userId: "user-1",
  companyId: "company-1"
};

const credentials = {
  type: "oauth2",
  accessToken: "new-access",
  refreshToken: "new-refresh",
  expiresAt: "2026-09-11T13:00:00.000Z",
  environment: "production"
};

async function callbackRequest(
  overrides: { state?: string; cookie?: string } = {}
) {
  const issued = await issueOAuthState(identity);
  const state = overrides.state ?? issued.state;
  return {
    issued,
    request: new Request(
      `https://erp.example.com/api/integrations/ramp/oauth?code=code-1&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: overrides.cookie ?? issued.cookie } }
    )
  };
}

async function run(request: Request) {
  return loader({ request, params: {} } as never) as Promise<Response>;
}

describe("Ramp OAuth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissions.mockResolvedValue({
      client: { role: "user" },
      userId: identity.userId,
      companyId: identity.companyId
    });
    exchangeRampOAuthCode.mockResolvedValue(credentials);
    patchRampOAuthCredentials.mockResolvedValue({
      id: "ramp",
      metadata: {}
    });
    rampOnInstall.mockResolvedValue(undefined);
  });

  it("rejects a forged state before exchanging the authorization code", async () => {
    const { request } = await callbackRequest({ state: "forged" });

    const response = await run(request);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://erp.example.com/x/settings/integrations?integration=ramp&error=invalid-state"
    );
    expect(response.headers.get("Set-Cookie")).toContain("carbon-oauth-state=");
    expect(exchangeRampOAuthCode).not.toHaveBeenCalled();
    expect(patchRampOAuthCredentials).not.toHaveBeenCalled();
  });

  it("consumes a valid state so replay cannot exchange or write twice", async () => {
    const { request } = await callbackRequest();
    const first = await run(request);
    const consumedCookie = first.headers.get("Set-Cookie") ?? "";
    const replayUrl = new URL(request.url);
    const replay = await run(
      new Request(replayUrl, { headers: { Cookie: consumedCookie } })
    );

    expect(first.status).toBe(302);
    expect(first.headers.get("Location")).toBe(
      "https://erp.example.com/x/settings/integrations"
    );
    expect(replay.headers.get("Location")).toContain("error=invalid-state");
    expect(exchangeRampOAuthCode).toHaveBeenCalledTimes(1);
    expect(patchRampOAuthCredentials).toHaveBeenCalledTimes(1);
  });

  it("atomically patches only OAuth-owned credentials", async () => {
    const { request } = await callbackRequest();

    await run(request);

    expect(patchRampOAuthCredentials).toHaveBeenCalledWith(
      { role: "service" },
      identity.companyId,
      { credentials, updatedBy: identity.userId }
    );
  });

  it("redirects with a stable error when the atomic credential patch fails", async () => {
    patchRampOAuthCredentials.mockRejectedValue(new Error("vault unavailable"));
    const { request } = await callbackRequest();

    const response = await run(request);

    expect(response.headers.get("Location")).toBe(
      "https://erp.example.com/x/settings/integrations?integration=ramp&error=save-failed"
    );
    expect(patchRampOAuthCredentials).toHaveBeenCalledTimes(1);
  });

  it("redirects token-exchange failures with a stable code and no provider detail", async () => {
    exchangeRampOAuthCode.mockRejectedValue(
      new Error("provider-controlled secret detail")
    );
    const { request } = await callbackRequest();

    const response = await run(request);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://erp.example.com/x/settings/integrations?integration=ramp&error=token-exchange"
    );
    expect(response.headers.get("Location")).not.toContain(
      "provider-controlled"
    );
    expect(patchRampOAuthCredentials).not.toHaveBeenCalled();
  });
});
