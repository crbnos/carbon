import { beforeEach, describe, expect, it, vi } from "vitest";

// getUserClaims reads redis / the get_claims RPC — the boundary. hasPermission
// runs real, so the "0" all-companies wildcard and the company match are the
// production rules.
const claims = vi.hoisted(() => ({
  current: null as null | {
    permissions: Record<string, Record<string, string[]>>;
    role: string | null;
  }
}));
vi.mock("@carbon/auth/users.server", () => ({
  getUserClaims: async () => claims.current
}));

// @carbon/auth's barrel reaches @carbon/glossary, whose Lingui `msg` macros
// vitest does not transform.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

import { requireToolPermission } from "./tool-permission.server";

const permission = (companies: string[]) => ({
  view: companies,
  create: companies,
  update: companies,
  delete: companies
});

beforeEach(() => {
  claims.current = null;
});

describe("requireToolPermission", () => {
  it("passes when the caller holds the module action in this company", async () => {
    claims.current = {
      permissions: { accounting: permission(["c1"]) },
      role: "employee"
    };
    await expect(
      requireToolPermission("c1", "u1", { update: "accounting" }, "post runs")
    ).resolves.toBeUndefined();
  });

  it("refuses a permission held only in another company", async () => {
    claims.current = {
      permissions: { accounting: permission(["c2"]) },
      role: "employee"
    };
    await expect(
      requireToolPermission("c1", "u1", { update: "accounting" }, "post runs")
    ).rejects.toThrow(
      "You do not have permission to post runs (accounting update)."
    );
  });

  it("honours the all-companies wildcard", async () => {
    claims.current = {
      permissions: { quality: permission(["0"]) },
      role: "employee"
    };
    await expect(
      requireToolPermission("c1", "u1", { update: "quality" }, "record samples")
    ).resolves.toBeUndefined();
  });

  it("refuses a caller without the required role", async () => {
    claims.current = {
      permissions: { quality: permission(["c1"]) },
      role: "customer"
    };
    await expect(
      requireToolPermission(
        "c1",
        "u1",
        { update: "quality", role: "employee" },
        "record samples"
      )
    ).rejects.toThrow("(employee role)");
  });

  it("refuses when no claims resolve", async () => {
    await expect(
      requireToolPermission("c1", "u1", { update: "quality" }, "record samples")
    ).rejects.toThrow("(quality update)");
  });
});
