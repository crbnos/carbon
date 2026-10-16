// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  hasPermissions,
  type ModulePermissions,
  permissionsFromClaims
} from "./permissions";

const none = { view: [], create: [], update: [], delete: [] };
const claims: ModulePermissions = {
  inventory: { ...none, view: ["co1"], update: ["co1"] },
  production: { ...none, view: ["co1", "co2"] }
};

describe("hasPermissions", () => {
  it("grants when every required module_action names the company", () => {
    expect(
      hasPermissions(claims, "co1", { update: "inventory", view: "production" })
    ).toBe(true);
  });

  it("refuses when one module_action is missing", () => {
    expect(
      hasPermissions(claims, "co1", {
        update: ["inventory", "production"]
      })
    ).toBe(false);
  });

  it("refuses a permission held in another company only", () => {
    expect(hasPermissions(claims, "co2", { update: "inventory" })).toBe(false);
  });

  it("with nothing required, still needs membership of the company", () => {
    expect(hasPermissions(claims, "co2", {})).toBe(true);
    expect(hasPermissions(claims, "co3", {})).toBe(false);
  });
});

describe("permissionsFromClaims", () => {
  it("groups <module>_<action> claims by module and ignores the rest", () => {
    expect(
      permissionsFromClaims({
        role: "employee",
        inventory_update: ["co1"],
        inventory_view: ["co1", "co2"],
        "not-a-claim": ["co1"],
        users_admin: ["co1"],
        sales_view: "co1"
      })
    ).toEqual({
      inventory: {
        view: ["co1", "co2"],
        create: [],
        update: ["co1"],
        delete: []
      }
    });
  });
});
