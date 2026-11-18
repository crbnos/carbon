// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Plan } from "@carbon/utils";
import { describe, expect, it, vi } from "vitest";

const resolveLicence = vi.hoisted(() => vi.fn());

vi.mock("@carbon/auth", () => ({
  CarbonEdition: "enterprise",
  error: vi.fn(),
  STRIPE_BYPASS_COMPANY_IDS: ""
}));
vi.mock("@carbon/auth/company.server", () => ({}));
vi.mock("@carbon/auth/session.server", () => ({ flash: vi.fn() }));
vi.mock("./license/resolve.server", () => ({ resolveLicence }));
vi.mock("./license/entitlement", async (actual) => ({
  ...(await actual<typeof import("./license/entitlement")>()),
  LICENCE_ENFORCED: true
}));

import { companyHasFeature, type GatePurpose } from "./plan.server";

const licence = (status: string) => ({
  kind: "licence",
  status,
  plan: Plan.Business,
  overrides: {}
});
const ask = (feature: "MCP" | "PERMISSIONS", purpose?: GatePurpose) =>
  companyHasFeature({} as never, "company-1", { feature }, purpose);

describe("companyHasFeature on Enterprise, by purpose", () => {
  it("runs but does not author during the grace period", async () => {
    resolveLicence.mockResolvedValue(licence("expired"));
    expect(await ask("MCP")).toBe(true);
    expect(await ask("MCP", "author")).toBe(false);
  });

  it("keeps enforcing access control after the licence ends, and nothing else", async () => {
    resolveLicence.mockResolvedValue(licence("terminated"));
    expect(await ask("PERMISSIONS")).toBe(false);
    expect(await ask("PERMISSIONS", "enforce")).toBe(true);
    expect(await ask("MCP", "enforce")).toBe(false);
  });
});
