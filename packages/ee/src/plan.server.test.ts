// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Plan } from "@carbon/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCompanyPlanId = vi.hoisted(() => vi.fn());
const isCarbonOwnedCompany = vi.hoisted(() => vi.fn());

vi.mock("@carbon/auth", () => ({
  CarbonEdition: "cloud",
  error: vi.fn(),
  STRIPE_BYPASS_COMPANY_IDS: ""
}));
vi.mock("@carbon/auth/company.server", () => ({
  getCompanyPlanId,
  isCarbonOwnedCompany
}));
vi.mock("@carbon/auth/session.server", () => ({ flash: vi.fn() }));

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

describe("plan gate reads companyPlan through the shared service-role reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isCarbonOwnedCompany.mockResolvedValue(false);
  });

  it("grants a PARTNER-* company MCP even when the caller's client cannot see the plan row", async () => {
    // Regression: a paying Partner (planId "PARTNER-33") was 402'd from MCP
    // because companyHasFeature read companyPlan through the RLS-scoped api-key
    // client, which returns no row -> Plan.Unknown -> blocked.
    getCompanyPlanId.mockResolvedValue("PARTNER-33");
    const client = rlsBlockedClient();

    const allowed = await companyHasFeature(client as never, "company-1", {
      feature: "MCP"
    });

    expect(allowed).toBe(true);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("still blocks a Starter company", async () => {
    getCompanyPlanId.mockResolvedValue(Plan.Starter);

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
