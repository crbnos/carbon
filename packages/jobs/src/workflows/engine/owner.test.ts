// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getClaims, makePermissionsFromClaims } from "@carbon/auth";
import { describe, expect, it, vi } from "vitest";
import {
  hasPermission,
  type OwnerPermissions,
  readOwnerPermissions
} from "./owner";

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
  it("no longer grants on the retired all-companies wildcard (NIST 3.1.5)", () => {
    // "0" was the global-company wildcard; it was removed. It is now just a
    // literal company id that never matches a real one.
    const perms = permissions({ purchasing: { view: ["0"] } });
    expect(hasPermission(perms, "purchasing", "view", "cmp_1")).toBe(false);
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

describe("readOwnerPermissions", () => {
  const client = {} as Parameters<typeof readOwnerPermissions>[0];
  const owned = permissions({ parts: { view: ["c1"] } });

  function ownerWithRole(role: string) {
    vi.mocked(getClaims).mockResolvedValueOnce({
      data: { role },
      error: null
    } as never);
    vi.mocked(makePermissionsFromClaims).mockReturnValueOnce({
      role,
      permissions: owned
    });
  }

  it("returns an employee owner's permissions", async () => {
    ownerWithRole("employee");
    expect(await readOwnerPermissions(client, "u1", "c1")).toEqual(owned);
  });

  it("runs nothing for an owner who became a portal account", async () => {
    ownerWithRole("customer");
    expect(await readOwnerPermissions(client, "u1", "c1")).toBeNull();
  });
});
