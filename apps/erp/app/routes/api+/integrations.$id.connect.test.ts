// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it, vi } from "vitest";

const requirePermissions = vi.hoisted(() => vi.fn());
// "brex" stands in for a second spend provider: with only Ramp registered, a
// spend role conflict would otherwise be unreachable.
const getIntegrationIdsByRole = vi.hoisted(() =>
  vi.fn((role: string) =>
    role === "spend" ? ["ramp", "brex"] : ["rillet", "xero", "quickbooks"]
  )
);

const RAMP = vi.hoisted(() => ({
  id: "ramp",
  providerRole: "spend",
  internalOnly: false,
  oauth: {
    authUrl: "https://app.ramp.com/v1/authorize",
    clientId: "client-1",
    redirectUri: "/api/integrations/ramp/oauth",
    scopes: ["accounting:read", "accounting:write", "offline_access"]
  },
  modes: [
    {
      id: "provider",
      scopes: ["accounting:read", "accounting:write", "offline_access"]
    },
    {
      id: "push-only",
      scopes: ["accounting:read", "bills:write", "offline_access"]
    }
  ]
}));

vi.mock("@carbon/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  CarbonEdition: "cloud",
  getAppUrl: () => "https://erp.example.com"
}));
vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions }));
vi.mock("@carbon/ee", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  integrations: [RAMP],
  getIntegrationIdsByRole
}));

import { loader } from "./integrations.$id.connect";

type Row = { id: string; companyId: string; active: boolean };

// In-memory companyIntegration table that applies the eq filters it is given.
function integrationTable(rows: Row[]) {
  const query = (filters: [string, unknown][]) => {
    const matched = () =>
      rows.filter((row) =>
        filters.every(([column, value]) => row[column as keyof Row] === value)
      );
    return {
      eq: (column: string, value: unknown) =>
        query([...filters, [column, value]]),
      maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: matched(), error: null })
    };
  };
  return { from: () => ({ select: () => query([]) }) };
}

async function connect(mode: string | null, rows: Row[] = []) {
  requirePermissions.mockResolvedValue({
    userId: "user-1",
    companyId: "company-1",
    email: "user@example.com",
    client: integrationTable(rows)
  });

  const url = new URL("https://erp.example.com/api/integrations/ramp/connect");
  if (mode !== null) url.searchParams.set("mode", mode);

  const response = (await loader({
    request: new Request(url),
    params: { id: "ramp" }
  } as never)) as Response;
  return {
    location: new URL(response.headers.get("Location") ?? ""),
    cookie: response.headers.get("Set-Cookie") ?? ""
  };
}

const active = (id: string): Row => ({
  id,
  companyId: "company-1",
  active: true
});

afterEach(() => {
  RAMP.internalOnly = false;
});

describe("integration connect route", () => {
  it.each([
    ["push-only", "bills:write"],
    ["provider", "accounting:write"]
  ])(
    "requests the %s mode's scopes with a signed state cookie",
    async (mode, scope) => {
      const { location, cookie } = await connect(mode);

      expect(cookie).toContain("carbon-oauth-state=");
      expect(location.origin + location.pathname).toBe(
        "https://app.ramp.com/v1/authorize"
      );
      expect(location.searchParams.get("scope")?.split(" ")).toContain(scope);
    }
  );

  it("never asks a push-only connect for accounting:write", async () => {
    // accounting:write takes Ramp's single accounting seat.
    const { location } = await connect("push-only");
    expect(location.searchParams.get("scope")?.split(" ")).not.toContain(
      "accounting:write"
    );
  });

  it("allows reconnecting the integration that already holds the slot", async () => {
    const { location } = await connect("push-only", [active("ramp")]);
    expect(location.host).toBe("app.ramp.com");
  });

  it.each([
    { name: "an unknown mode", mode: "nonsense", error: "invalid-mode" },
    { name: "an absent mode", mode: null, error: "invalid-mode" },
    {
      name: "another spend integration holds the role",
      mode: "push-only",
      rows: [active("brex")],
      error: "role-conflict"
    },
    {
      name: "the install is withheld from this user",
      mode: "push-only",
      internalOnly: true,
      error: "coming-soon"
    }
  ])(
    "refuses before consent when $name",
    async ({ mode, rows, internalOnly, error }) => {
      RAMP.internalOnly = internalOnly ?? false;

      const { location } = await connect(mode, rows);

      expect(location.host).toBe("erp.example.com");
      expect(location.searchParams.get("error")).toBe(error);
    }
  );
});
