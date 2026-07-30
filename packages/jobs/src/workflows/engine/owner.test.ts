import { describe, expect, it, vi } from "vitest";
import { hasPermission, type OwnerPermissions } from "./owner";

// The @carbon/auth barrel pulls @carbon/react (lingui macros) — unloadable under node vitest.
vi.mock("@carbon/auth", () => ({
  getClaims: vi.fn(),
  makePermissionsFromClaims: vi.fn()
}));
vi.mock("@carbon/auth/client.server", () => ({
  getUserScopedClient: vi.fn()
}));

function permissions(
  overrides: Partial<Record<string, Partial<OwnerPermissions[string]>>> = {}
): OwnerPermissions {
  const base: OwnerPermissions = {};
  for (const [module, actions] of Object.entries(overrides)) {
    base[module] = {
      view: [],
      create: [],
      update: [],
      delete: [],
      ...actions
    };
  }
  return base;
}

describe("hasPermission", () => {
  it("grants when the action holds the all-companies wildcard", () => {
    const perms = permissions({ purchasing: { view: ["0"] } });
    expect(hasPermission(perms, "purchasing", "view", "cmp_1")).toBe(true);
  });

  it("grants when the action names the company exactly", () => {
    const perms = permissions({ purchasing: { view: ["cmp_1", "cmp_2"] } });
    expect(hasPermission(perms, "purchasing", "view", "cmp_1")).toBe(true);
  });

  it("denies a company the action does not name", () => {
    const perms = permissions({ purchasing: { view: ["cmp_2"] } });
    expect(hasPermission(perms, "purchasing", "view", "cmp_1")).toBe(false);
  });

  it("denies a module the owner does not hold at all", () => {
    const perms = permissions({ purchasing: { view: ["0"] } });
    expect(hasPermission(perms, "sales", "view", "cmp_1")).toBe(false);
  });

  it("denies an action whose array is empty", () => {
    const perms = permissions({ purchasing: { view: ["0"] } });
    expect(hasPermission(perms, "purchasing", "update", "cmp_1")).toBe(false);
  });

  it("denies when the action array is missing entirely", () => {
    const perms = {
      purchasing: { view: ["0"] }
    } as unknown as OwnerPermissions;
    expect(hasPermission(perms, "purchasing", "delete", "cmp_1")).toBe(false);
  });
});
