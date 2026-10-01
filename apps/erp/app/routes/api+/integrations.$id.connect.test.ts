// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

const requirePermissions = vi.hoisted(() => vi.fn());
// Role-aware, because the guard compares the incumbent row against the ids of
// that ROLE. "brex" stands in for a second spend provider: with only Ramp
// registered today a spend role conflict is unreachable, so the guard would
// otherwise be untestable — and silently so.
const getIntegrationIdsByRole = vi.hoisted(() =>
  vi.fn((role: string) =>
    role === "spend" ? ["ramp", "brex"] : ["rillet", "xero", "quickbooks"]
  )
);

const RAMP = vi.hoisted(() => ({
  id: "ramp",
  providerRole: "spend",
  oauth: {
    authUrl: "https://app.ramp.com/v1/authorize",
    clientId: "client-1",
    redirectUri: "/api/integrations/ramp/oauth",
    scopes: ["accounting:read", "accounting:write", "offline_access"]
  },
  modes: [
    {
      id: "provider",
      label: "Carbon is my accounting system",
      description: "…",
      scopes: ["accounting:read", "accounting:write", "offline_access"]
    },
    {
      id: "push-only",
      label: "Another system posts my ledger",
      description: "…",
      scopes: ["accounting:read", "bills:write", "offline_access"]
    }
  ]
}));

vi.mock("@carbon/auth", () => ({
  CARBON_API_URL: "https://api.example.com",
  SUPABASE_URL: "http://localhost",
  getAppUrl: () => "https://erp.example.com",
  getMESUrl: () => "https://mes.example.com"
}));
vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions }));
vi.mock("@carbon/ee", () => ({
  integrations: [RAMP],
  getIntegrationIdsByRole
}));

import { loader } from "./integrations.$id.connect";

function activeRows(rows: Array<{ id: string }>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => Promise.resolve({ data: rows, error: null }) })
      })
    })
  };
}

async function connect(mode: string | null, rows: Array<{ id: string }> = []) {
  requirePermissions.mockResolvedValue({
    userId: "user-1",
    companyId: "company-1",
    client: activeRows(rows)
  });

  const url = new URL("https://erp.example.com/api/integrations/ramp/connect");
  if (mode !== null) url.searchParams.set("mode", mode);

  return (await loader({
    request: new Request(url),
    params: { id: "ramp" }
  } as never)) as Response;
}

describe("integration connect route", () => {
  it("builds the authorize URL from the CHOSEN mode's scopes", async () => {
    const response = await connect("push-only");
    const location = new URL(response.headers.get("Location") ?? "");

    // The security property: the scope list comes from the descriptor's mode,
    // server-side. `accounting:write` is what takes Ramp's single accounting
    // seat, so a push-only connect must never ask for it.
    const scopes = (location.searchParams.get("scope") ?? "").split(" ");
    expect(scopes).toContain("bills:write");
    expect(scopes).not.toContain("accounting:write");
    expect(location.origin + location.pathname).toBe(
      "https://app.ramp.com/v1/authorize"
    );
  });

  it("requests the provider scopes for provider mode", async () => {
    const response = await connect("provider");
    const scopes = (
      new URL(response.headers.get("Location") ?? "").searchParams.get(
        "scope"
      ) ?? ""
    ).split(" ");

    expect(scopes).toContain("accounting:write");
  });

  it("sets the signed state cookie", async () => {
    const response = await connect("push-only");
    expect(response.headers.get("Set-Cookie")).toContain("carbon-oauth-state=");
  });

  it("refuses an unknown mode instead of defaulting", async () => {
    // Silently defaulting would request `accounting:write` against a customer
    // who chose push-only — the exact failure the mode exists to prevent.
    const response = await connect("nonsense");

    expect(response.headers.get("Location")).toContain("error=invalid-mode");
    expect(response.headers.get("Location")).not.toContain("ramp.com");
  });

  it("refuses an ABSENT mode for an integration that declares modes", async () => {
    const response = await connect(null);

    expect(response.headers.get("Location")).toContain("error=invalid-mode");
  });

  it("refuses before consent when the role slot is taken", async () => {
    // Reaching the database's one-active-per-role refusal AFTER the customer has
    // authorized leaves them with a live grant and no install.
    const response = await connect("push-only", [{ id: "brex" }]);

    expect(response.headers.get("Location")).toContain("error=role-conflict");
    expect(response.headers.get("Location")).not.toContain("ramp.com");
  });

  it("allows reconnecting the SAME integration that holds the slot", async () => {
    const response = await connect("push-only", [{ id: "ramp" }]);

    expect(response.headers.get("Location")).toContain("ramp.com");
  });
});
