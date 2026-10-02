// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Plan } from "@carbon/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceRoleMaybeSingle = vi.hoisted(() => vi.fn());
const serviceRoleFrom = vi.hoisted(() =>
  vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle: serviceRoleMaybeSingle }) })
  }))
);
const isCarbonOwnedCompany = vi.hoisted(() => vi.fn());
const redisGet = vi.hoisted(() => vi.fn());
const redisSet = vi.hoisted(() => vi.fn());

vi.mock("@carbon/auth", () => ({
  CarbonEdition: "cloud",
  error: vi.fn(),
  STRIPE_BYPASS_COMPANY_IDS: ""
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({ from: serviceRoleFrom })
}));
vi.mock("@carbon/auth/company.server", () => ({ isCarbonOwnedCompany }));
vi.mock("@carbon/auth/session.server", () => ({ flash: vi.fn() }));
vi.mock("@carbon/kv", () => ({ redis: { get: redisGet, set: redisSet } }));
vi.mock("@carbon/logger/middleware.server", () => ({
  oncePerRead: (_key: string, compute: () => unknown) => compute()
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  })
}));

import { companyHasFeature } from "./plan.server";

// Stands in for the anon `carbon-key` API-key client the MCP/API paths carry:
// `companyPlan`'s RLS SELECT policy requires an authenticated `auth.uid()`, so
// this client sees no row. If the gate ever reads the plan through the caller's
// client again, `from` is called and the assertion fails.
function rlsBlockedClient() {
  // Under `maybeSingle()` a zero-row read is `data: null` with NO error — the
  // "never subscribed"/RLS-invisible case. The gate must never reach this client
  // anyway (it reads via service role), so `from` is asserted uncalled below.
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle }) })
  }));
  return { from };
}

describe("plan gate reads companyPlan via service role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isCarbonOwnedCompany.mockResolvedValue(false);
    redisGet.mockResolvedValue(null);
  });

  it("grants a PARTNER-* company MCP even when the caller's client cannot see the plan row", async () => {
    // Regression: a paying Partner (planId "PARTNER-33") was 402'd from MCP
    // because companyHasFeature read companyPlan through the RLS-scoped api-key
    // client, which returns no row -> Plan.Unknown -> blocked.
    serviceRoleMaybeSingle.mockResolvedValue({
      data: { planId: "PARTNER-33" },
      error: null
    });
    const client = rlsBlockedClient();

    const allowed = await companyHasFeature(client as never, "company-1", {
      feature: "MCP"
    });

    expect(allowed).toBe(true);
    expect(serviceRoleFrom).toHaveBeenCalledWith("companyPlan");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("still blocks a Starter company", async () => {
    serviceRoleMaybeSingle.mockResolvedValue({
      data: { planId: Plan.Starter },
      error: null
    });

    const allowed = await companyHasFeature(
      rlsBlockedClient() as never,
      "company-2",
      {
        feature: "MCP"
      }
    );

    expect(allowed).toBe(false);
  });
});

describe("plan gate cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isCarbonOwnedCompany.mockResolvedValue(false);
    redisGet.mockResolvedValue(null);
  });

  it("answers from Redis without reading companyPlan", async () => {
    redisGet.mockResolvedValue("PARTNER-33");

    const allowed = await companyHasFeature(
      rlsBlockedClient() as never,
      "company-1",
      { feature: "MCP" }
    );

    expect(allowed).toBe(true);
    expect(redisGet).toHaveBeenCalledWith("companyPlan:company-1");
    expect(serviceRoleFrom).not.toHaveBeenCalled();
  });

  it("does not cache a missing plan row", async () => {
    serviceRoleMaybeSingle.mockResolvedValue({ data: null, error: null });

    await companyHasFeature(rlsBlockedClient() as never, "company-3", {
      feature: "MCP"
    });

    expect(redisSet).not.toHaveBeenCalled();
  });
});
