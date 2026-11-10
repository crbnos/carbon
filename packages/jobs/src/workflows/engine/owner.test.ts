// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readClaimsFresh } from "@carbon/auth";
import type { CompanyRole, ExpandedClaims } from "@carbon/database/access";
import { describe, expect, it, vi } from "vitest";
import { readOwnerPermissions } from "./owner";

// The @carbon/auth barrel pulls @carbon/react (lingui macros) — unloadable under node vitest.
vi.mock("@carbon/auth", () => ({
  readClaimsFresh: vi.fn()
}));
vi.mock("@carbon/auth/client.server", () => ({
  getUserScopedClient: vi.fn()
}));

describe("readOwnerPermissions", () => {
  const client = {} as Parameters<typeof readOwnerPermissions>[0];
  const owned: ExpandedClaims = {
    "parts.parts": { view: ["c1"], create: [], update: [], delete: [] }
  };

  function ownerWithRole(role: CompanyRole) {
    vi.mocked(readClaimsFresh).mockResolvedValueOnce({
      role,
      admin: false,
      grants: [],
      portal: {},
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

  it("runs nothing when the owner's claims cannot be read", async () => {
    vi.mocked(readClaimsFresh).mockRejectedValueOnce(new Error("down"));
    expect(await readOwnerPermissions(client, "u1", "c1")).toBeNull();
  });
});
