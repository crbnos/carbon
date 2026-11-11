// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { claimsFor } from "@carbon/database/access";
import { describe, expect, it, vi } from "vitest";
import { ownerPermissionsOf, ownerRefusal } from "./owner";

// @carbon/auth/client.server reads its configuration once, at import.
vi.hoisted(() => {
  vi.stubEnv("SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
});

/** `get_claims` for an owner in c1 with `level` on Purchase Orders. */
function owner(role: string, level: "View" | "Edit" | null) {
  return claimsFor(
    {
      role,
      admin: false,
      grants:
        level === null
          ? []
          : [
              {
                subject: "role",
                module: "Purchasing",
                page: "purchasing.purchaseOrders",
                level
              }
            ],
      portal: {}
    },
    "c1"
  );
}

describe("ownerPermissionsOf", () => {
  it("returns an employee owner's permissions", () => {
    const permissions = ownerPermissionsOf(owner("employee", "View"), "c1");
    expect(permissions?.["purchasing.purchaseOrders"]).toEqual({
      view: ["c1"],
      create: [],
      update: [],
      delete: []
    });
  });

  it("runs nothing for an owner who became a portal account", () => {
    expect(ownerPermissionsOf(owner("customer", "View"), "c1")).toBeNull();
    expect(ownerPermissionsOf(owner("supplier", "View"), "c1")).toBeNull();
  });

  it("runs nothing when the owner's claims cannot be read", () => {
    expect(ownerPermissionsOf(null, "c1")).toBeNull();
  });
});

describe("ownerRefusal", () => {
  const LOST =
    "The owner of this workflow no longer has access to Purchase Orders.";
  const permissionsWith = (level: "View" | "Edit" | null) =>
    owner("employee", level).permissions;

  // An action step: the trigger's View still holds, the step's Edit does not.
  it("refuses an Edit step on Purchase Orders to an owner with View only", () => {
    const gate = { "purchasing.purchaseOrders": "Edit" } as const;
    expect(ownerRefusal(gate, permissionsWith("View"), "c1")).toBe(LOST);
    expect(ownerRefusal(gate, permissionsWith("Edit"), "c1")).toBeNull();
  });

  // The trigger's own page: without View the whole run is refused.
  it("refuses the trigger's View gate to an owner who lost the page", () => {
    const gate = { "purchasing.purchaseOrders": "View" } as const;
    expect(ownerRefusal(gate, permissionsWith(null), "c1")).toBe(LOST);
    expect(ownerRefusal(gate, permissionsWith("View"), "c1")).toBeNull();
  });

  it("holds only in the company the grant is in", () => {
    const gate = { "purchasing.purchaseOrders": "View" } as const;
    expect(ownerRefusal(gate, permissionsWith("Edit"), "c2")).toBe(LOST);
  });

  it("refuses nothing when the step has no gate", () => {
    expect(ownerRefusal(undefined, permissionsWith(null), "c1")).toBeNull();
  });
});
