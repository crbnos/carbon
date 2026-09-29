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
// The route no longer decides which connection counts — it delegates to the pure
// `resolveConnectedProviderName`, whose status filtering (including the
// `unlinked` tombstone `DELETE` leaves behind) is pinned by its own real-fixture
// tests in `packages/ee/src/ramp/lib/connection-status.test.ts`. What is left to
// assert HERE is the wiring: the resolver sees Ramp's response, and whatever it
// returns is what gets stored.
const resolveConnectedProviderName = vi.hoisted(() => vi.fn());
const rampOnInstall = vi.hoisted(() => vi.fn());
// Real predicate, not a stub: it is a two-line structural check and mocking it
// would make the test pass on a shape the production code rejects.
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
  overrides: { state?: string; cookie?: string; mode?: string } = {}
) {
  // The REAL state module, so the mode genuinely round-trips through the signed,
  // HttpOnly cookie rather than through a stub.
  const issued = await issueOAuthState({ ...identity, mode: overrides.mode });
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
    exchangeRampOAuthCode.mockResolvedValue({
      credentials,
      grantedScopes: ["accounting:read", "bills:write"]
    });
    patchRampOAuthCredentials.mockResolvedValue({
      id: "ramp",
      metadata: {}
    });
    rampOnInstall.mockResolvedValue(undefined);
    getAccountingConnections.mockResolvedValue({ connections: [] });
    resolveConnectedProviderName.mockReturnValue(undefined);
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
      {
        credentials,
        // What the token response GRANTED, not what was requested — RFC 6749 §3.3
        // permits a narrower grant, and recording the request would make the UI
        // claim capabilities the token may not carry.
        grantedScopes: ["accounting:read", "bills:write"],
        // Absent here: the fixture's state carries no mode, and a missing mode
        // must stay missing rather than defaulting — `resolveRampMode` is the one
        // place that decides an unstamped install is `provider`.
        syncMode: undefined,
        accountingConnectionProvider: undefined,
        updatedBy: identity.userId
      }
    );
  });

  it("stamps the mode from the SIGNED state, never a query parameter", async () => {
    // A user-editable mode would let someone consent to push-only's narrow scopes
    // and have Carbon record a provider-mode install, or the reverse. The mode is
    // in the cookie here and NOT in the URL — the assertion only passes if the
    // callback reads the signed payload.
    const { request } = await callbackRequest({ mode: "push-only" });
    expect(new URL(request.url).searchParams.get("mode")).toBeNull();

    await run(request);

    expect(patchRampOAuthCredentials).toHaveBeenCalledWith(
      { role: "service" },
      identity.companyId,
      expect.objectContaining({ syncMode: "push-only" })
    );
  });

  it("ignores a mode supplied in the query string", async () => {
    // Belt-and-braces on the same property: a forged `?mode=` must not reach the
    // stored install when the signed state says nothing.
    const { request } = await callbackRequest();
    const forged = new URL(request.url);
    forged.searchParams.set("mode", "provider");

    await run(new Request(forged, { headers: request.headers }));

    expect(patchRampOAuthCredentials).toHaveBeenCalledWith(
      { role: "service" },
      identity.companyId,
      expect.objectContaining({ syncMode: undefined })
    );
  });

  it("records the peer connection owner when Ramp reports one", async () => {
    const response = {
      connections: [{ remote_provider_name: "Rillet", status: "linked" }]
    };
    getAccountingConnections.mockResolvedValue(response);
    resolveConnectedProviderName.mockReturnValue("Rillet");
    const { request } = await callbackRequest();

    await run(request);

    // The resolver is handed Ramp's response verbatim — a route that pre-filtered
    // or reshaped it would reintroduce the second, divergent reading this
    // delegation removed.
    expect(resolveConnectedProviderName).toHaveBeenCalledWith(response);
    expect(patchRampOAuthCredentials).toHaveBeenCalledWith(
      { role: "service" },
      identity.companyId,
      expect.objectContaining({ accountingConnectionProvider: "Rillet" })
    );
  });

  it("records UNKNOWN when no connection is live", async () => {
    // The reachable case after a disconnect: Ramp still returns the old
    // connection as an `unlinked` tombstone carrying its provider name, and the
    // resolver filters it out. Storing a name here would claim a ledger holder
    // for a business that has none.
    getAccountingConnections.mockResolvedValue({
      connections: [{ remote_provider_name: "Carbon", status: "unlinked" }]
    });
    resolveConnectedProviderName.mockReturnValue(undefined);
    const { request } = await callbackRequest();

    await run(request);

    expect(patchRampOAuthCredentials).toHaveBeenCalledWith(
      { role: "service" },
      identity.companyId,
      expect.objectContaining({ accountingConnectionProvider: undefined })
    );
  });

  it("completes the install when the peer read FAILS", async () => {
    // Whether a token lacking `accounting:write` may call all-connections is an
    // OPEN QUESTION. A 403 must leave the owner UNKNOWN and still install — the
    // grant is already valid at this point, and failing here would strand it.
    getAccountingConnections.mockRejectedValue(new Error("403 DEVELOPER_7100"));
    const { request } = await callbackRequest();

    const response = await run(request);

    expect(patchRampOAuthCredentials).toHaveBeenCalledWith(
      { role: "service" },
      identity.companyId,
      expect.objectContaining({ accountingConnectionProvider: undefined })
    );
    expect(response.headers.get("Location")).toBe(
      "https://erp.example.com/x/settings/integrations"
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

  it("names the seat conflict instead of a generic setup failure", async () => {
    // Ramp permits ONE connected accounting system. "Try connecting again" is
    // actively wrong here — a retry cannot succeed until the other system is
    // disconnected or the customer picks push-only.
    const conflict = Object.assign(
      new Error("Ramp's accounting connection is held by Rillet."),
      { code: "RAMP_SEAT_CONFLICT" }
    );
    rampOnInstall.mockRejectedValue(conflict);
    const { request } = await callbackRequest();

    const response = await run(request);

    expect(response.headers.get("Location")).toBe(
      "https://erp.example.com/x/settings/integrations?integration=ramp&error=seat-conflict"
    );
    // The provider-supplied holder name must not cross the URL.
    expect(response.headers.get("Location")).not.toContain("Rillet");
  });

  it("still reports an ordinary install failure generically", async () => {
    rampOnInstall.mockRejectedValue(new Error("webhook exploded"));
    const { request } = await callbackRequest();

    const response = await run(request);

    expect(response.headers.get("Location")).toBe(
      "https://erp.example.com/x/settings/integrations?integration=ramp&error=install-failed"
    );
  });
});
