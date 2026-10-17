// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { InvalidInputError } from "./errors";
import {
  hasPermissions,
  type ModulePermissions,
  type PermissionRule,
  permissionsFromClaims,
  resolvePermissions
} from "./permissions";

describe("resolvePermissions", () => {
  const rule: PermissionRule<{ type: "post" | "void" }> = {
    by: "type",
    rules: { post: { update: "invoicing" }, void: { delete: "invoicing" } }
  };
  const refusal = (input: unknown) => {
    try {
      resolvePermissions(rule, input as { type: "post" });
    } catch (err) {
      return err;
    }
    throw new Error("expected a refusal");
  };

  it("resolves the rule of the value sent", () => {
    expect(resolvePermissions(rule, { type: "void" })).toEqual({
      delete: "invoicing"
    });
  });

  it("refuses an inherited key as invalid input naming the field", () => {
    const err = refusal({ type: "constructor" });
    expect(err).toBeInstanceOf(InvalidInputError);
    expect(err).toMatchObject({
      status: 400,
      message: "Invalid input — type: expected one of post, void"
    });
  });

  it("refuses an unknown or missing value the same way", () => {
    expect(refusal({ type: "bogus" })).toMatchObject({ status: 400 });
    expect(refusal({})).toMatchObject({ status: 400 });
    expect(refusal(undefined)).toMatchObject({ status: 400 });
  });

  it("returns a plain rule as it is", () => {
    expect(resolvePermissions("system", {})).toBe("system");
    expect(resolvePermissions({ view: "sales" }, {})).toEqual({
      view: "sales"
    });
  });
});

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
