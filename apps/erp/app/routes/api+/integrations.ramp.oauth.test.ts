// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { issueOAuthState } from "@carbon/auth/oauth-state.server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermissions = vi.hoisted(() => vi.fn());
const getCarbonServiceRole = vi.hoisted(() =>
  vi.fn(() => ({ role: "service" }))
);
const exchangeRampOAuthCode = vi.hoisted(() => vi.fn());
const getAccountingConnections = vi.hoisted(() => vi.fn());
const buildRampClient = vi.hoisted(() =>
  vi.fn(() => ({ getAccountingConnections }))
);
const patchRampOAuthCredentials = vi.hoisted(() => vi.fn());
// Status filtering is pinned in packages/ee/src/ramp/lib/connection-status.test.ts.
const resolveConnectedProviderName = vi.hoisted(() => vi.fn());
const rampOnInstall = vi.hoisted(() => vi.fn());
const isRampSeatConflict = vi.hoisted(
  () => (error: unknown) =>
    (error as { code?: string })?.code === "RAMP_SEAT_CONFLICT"
);

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
  buildRampClient,
  exchangeRampOAuthCode,
  isRampSeatConflict,
  patchRampOAuthCredentials,
  resolveConnectedProviderName
}));

import { loader } from "./integrations.ramp.oauth";

const INTEGRATIONS = "https://erp.example.com/x/settings/integrations";

const identity = {
  integrationId: "ramp",
  userId: "user-1",
  companyId: "company-1"
};

const credentials = {
  type: "oauth2",
  accessToken: "new-access",
  refreshToken: "new-refresh",
  expiresAt: "2026-09-11T13:00:00.000Z"
};

// The real state module, so the mode round-trips through the signed cookie.
async function callbackRequest(
  overrides: { state?: string; mode?: string } = {}
) {
  const issued = await issueOAuthState({ ...identity, mode: overrides.mode });
  const state = overrides.state ?? issued.state;
  return new Request(
    `https://erp.example.com/api/integrations/ramp/oauth?code=code-1&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: issued.cookie } }
  );
}

function run(request: Request) {
  return loader({ request, params: {} } as never) as Promise<Response>;
}

function storedPatch() {
  return patchRampOAuthCredentials.mock.calls[0]?.[2];
}

describe("Ramp OAuth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissions.mockResolvedValue({
      client: { role: "user" },
      userId: identity.userId,
      companyId: identity.companyId
    });
    exchangeRampOAuthCode.mockResolvedValue({
      credentials,
      grantedScopes: ["accounting:read", "bills:write"]
    });
    patchRampOAuthCredentials.mockResolvedValue({ id: "ramp", metadata: {} });
    rampOnInstall.mockResolvedValue(undefined);
    getAccountingConnections.mockResolvedValue({ connections: [] });
    resolveConnectedProviderName.mockReturnValue(undefined);
  });

  it("rejects a forged state before exchanging the authorization code", async () => {
    const response = await run(await callbackRequest({ state: "forged" }));

    expect(response.headers.get("Location")).toBe(
      `${INTEGRATIONS}?integration=ramp&error=invalid-state`
    );
    expect(response.headers.get("Set-Cookie")).toContain("carbon-oauth-state=");
    expect(exchangeRampOAuthCode).not.toHaveBeenCalled();
  });

  it("consumes a valid state so a replay cannot exchange or write twice", async () => {
    const request = await callbackRequest();
    const first = await run(request);
    const replay = await run(
      new Request(request.url, {
        headers: { Cookie: first.headers.get("Set-Cookie") ?? "" }
      })
    );

    expect(first.headers.get("Location")).toBe(INTEGRATIONS);
    expect(replay.headers.get("Location")).toContain("error=invalid-state");
    expect(exchangeRampOAuthCode).toHaveBeenCalledTimes(1);
    expect(patchRampOAuthCredentials).toHaveBeenCalledTimes(1);
  });

  it("stores the granted scopes and leaves an unstamped mode and unknown owner empty", async () => {
    await run(await callbackRequest());

    // Granted, not requested: RFC 6749 §3.3 allows a narrower grant.
    expect(storedPatch()).toEqual({
      credentials,
      grantedScopes: ["accounting:read", "bills:write"],
      syncMode: undefined,
      accountingConnectionProvider: undefined,
      updatedBy: identity.userId
    });
  });

  it("stamps the mode from the signed state", async () => {
    await run(await callbackRequest({ mode: "push-only" }));
    expect(storedPatch()?.syncMode).toBe("push-only");
  });

  it("ignores a mode supplied in the query string", async () => {
    // A user-editable mode would let push-only's narrow consent record a provider install.
    const request = await callbackRequest();
    const forged = new URL(request.url);
    forged.searchParams.set("mode", "provider");

    await run(new Request(forged, { headers: request.headers }));

    expect(storedPatch()?.syncMode).toBeUndefined();
  });

  it("stores the provider the resolver reads from Ramp's connections", async () => {
    const connections = {
      connections: [{ remote_provider_name: "Rillet", status: "linked" }]
    };
    getAccountingConnections.mockResolvedValue(connections);
    resolveConnectedProviderName.mockImplementation((response) =>
      response === connections ? "Rillet" : undefined
    );

    await run(await callbackRequest());

    expect(storedPatch()?.accountingConnectionProvider).toBe("Rillet");
  });

  it("completes the install with an unknown owner when the peer read fails", async () => {
    // The grant is already valid here; failing on an informational read would strand it.
    getAccountingConnections.mockRejectedValue(new Error("403 DEVELOPER_7100"));

    const response = await run(await callbackRequest());

    expect(storedPatch()?.accountingConnectionProvider).toBeUndefined();
    expect(response.headers.get("Location")).toBe(INTEGRATIONS);
  });

  it.each([
    {
      failure: "the token exchange fails",
      arrange: () =>
        exchangeRampOAuthCode.mockRejectedValue(
          new Error("provider-controlled detail")
        ),
      error: "token-exchange"
    },
    {
      failure: "another spend integration holds the slot",
      arrange: () =>
        patchRampOAuthCredentials.mockRejectedValue({ code: "23505" }),
      error: "role-conflict"
    },
    {
      failure: "the credential patch fails",
      arrange: () =>
        patchRampOAuthCredentials.mockRejectedValue(
          new Error("vault unavailable")
        ),
      error: "save-failed"
    },
    {
      failure: "another system holds Ramp's accounting seat",
      arrange: () =>
        rampOnInstall.mockRejectedValue(
          Object.assign(new Error("held by Rillet"), {
            code: "RAMP_SEAT_CONFLICT"
          })
        ),
      error: "seat-conflict"
    },
    {
      failure: "the install converge fails",
      arrange: () => rampOnInstall.mockRejectedValue(new Error("webhook")),
      error: "install-failed"
    }
  ])(
    "redirects with error=$error when $failure",
    async ({ arrange, error }) => {
      arrange();

      const response = await run(await callbackRequest());

      // Only a stable code crosses the URL, never provider text.
      expect(response.headers.get("Location")).toBe(
        `${INTEGRATIONS}?integration=ramp&error=${error}`
      );
    }
  );
});
