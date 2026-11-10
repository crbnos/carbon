// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getClaims, makePermissionsFromClaims } from "@carbon/auth";
import { describe, expect, it, vi } from "vitest";
import { type OwnerPermissions, readOwnerPermissions } from "./owner";

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

describe("readOwnerPermissions", () => {
  const client = {} as Parameters<typeof readOwnerPermissions>[0];
  const owned = permissions({ "parts.parts": { view: ["c1"] } });

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
