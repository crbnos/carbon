// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getCompanyPlanId = vi.hoisted(() => vi.fn());
const getCompanyPlanIdOrThrow = vi.hoisted(() => vi.fn());

// Carbon Cloud, where the approval rules depend on the company's plan.
vi.mock("@carbon/auth", () => ({
  CarbonEdition: "cloud",
  error: vi.fn(),
  STRIPE_BYPASS_COMPANY_IDS: ""
}));
vi.mock("@carbon/auth/company.server", () => ({
  getCompanyPlanId,
  getCompanyPlanIdOrThrow,
  isCarbonOwnedCompany: async () => false,
  isCarbonOwnedCompanyOrThrow: async () => false
}));
vi.mock("@carbon/auth/session.server", () => ({ flash: vi.fn() }));

import { canApproveRequest, getApprovalRuleByAmount } from "./service";

/** Answers every query with the scrap tiers 0 and 500; the low one is "low"'s. */
function rulesClient() {
  const rules = [
    {
      lowerBoundAmount: 500,
      approverGroupIds: ["high"],
      defaultApproverId: null
    },
    { lowerBoundAmount: 0, approverGroupIds: ["low"], defaultApproverId: null }
  ];
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lte", "order", "limit"]) {
    query[method] = () => query;
  }
  query.maybeSingle = async () => ({ data: rules[0], error: null });
  query.then = (resolve: (value: unknown) => void) =>
    resolve({ data: rules, error: null });
  return {
    from: vi.fn(() => query),
    rpc: async () => ({ data: [], error: null })
  };
}

const scrapAt600 = {
  amount: 600,
  documentType: "scrap" as const,
  companyId: "company-1"
};

describe("a failed plan read in the approval rule lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The lenient read turns a failure into "no plan row".
    getCompanyPlanId.mockResolvedValue(null);
    getCompanyPlanIdOrThrow.mockRejectedValue(
      new Error("Failed to read company plan")
    );
  });

  it("reads as no rule for the callers that degrade", async () => {
    const client = rulesClient();
    await expect(
      getApprovalRuleByAmount(client as never, "scrap", "company-1", 600)
    ).resolves.toEqual({ data: null, error: null });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("throws when the lookup must fail closed", async () => {
    await expect(
      getApprovalRuleByAmount(
        rulesClient() as never,
        "scrap",
        "company-1",
        600,
        { failClosed: true }
      )
    ).rejects.toThrow("Failed to read company plan");
  });

  // Read as "no tier", the failure put the request at the lowest tier, where
  // the low-tier approver may approve it.
  it("lets a low-tier approver approve 600 only on the degrading path", async () => {
    await expect(
      canApproveRequest(rulesClient() as never, scrapAt600, "low")
    ).resolves.toBe(true);
    await expect(
      canApproveRequest(rulesClient() as never, scrapAt600, "low", {
        failClosed: true
      })
    ).rejects.toThrow("Failed to read company plan");
  });
});
