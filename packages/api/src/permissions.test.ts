// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { ForbiddenError, InvalidInputError, NotFoundError } from "./errors";
import {
  anyOfRule,
  hasPermissions,
  type ModulePermissions,
  meetsRequirement,
  type PermissionRule,
  permissionsFromClaims,
  permissionsFromScopes,
  requirementOfRows,
  resolvePermissions,
  rowRule
} from "./permissions";

describe("resolvePermissions", () => {
  const rule: PermissionRule<{ type: "post" | "void" }> = {
    by: "type",
    rules: {
      post: { "invoicing.payments": "Edit" },
      void: { "invoicing.payments": "Full" }
    }
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
      "invoicing.payments": "Full"
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
    expect(resolvePermissions({ "sales.quotes": "View" }, {})).toEqual({
      "sales.quotes": "View"
    });
  });
});

const none = { view: [], create: [], update: [], delete: [] };
const claims: ModulePermissions = {
  "inventory.receipts": {
    ...none,
    view: ["co1"],
    create: ["co1"],
    update: ["co1"]
  },
  "production.jobs": { ...none, view: ["co1", "co2"] }
};

describe("hasPermissions", () => {
  it("grants when every required page holds its level in the company", () => {
    expect(
      hasPermissions(claims, "co1", {
        "inventory.receipts": "Edit",
        "production.jobs": "View"
      })
    ).toBe(true);
  });

  it("reads a level as its highest action", () => {
    expect(
      hasPermissions(claims, "co1", { "inventory.receipts": "Create" })
    ).toBe(true);
    expect(
      hasPermissions(claims, "co1", { "inventory.receipts": "Full" })
    ).toBe(false);
    // Edit reads update alone: claims that hold update without view still pass.
    expect(
      hasPermissions(
        { "inventory.receipts": { ...none, update: ["co1"] } },
        "co1",
        { "inventory.receipts": "Edit" }
      )
    ).toBe(true);
  });

  it("refuses when one page is short of its level", () => {
    expect(
      hasPermissions(claims, "co1", {
        "inventory.receipts": "Edit",
        "production.jobs": "Edit"
      })
    ).toBe(false);
  });

  it("refuses a page the claims do not name", () => {
    expect(
      hasPermissions(claims, "co1", { "inventory.shipments": "View" })
    ).toBe(false);
  });

  it("refuses a permission held in another company only", () => {
    expect(
      hasPermissions(claims, "co2", { "inventory.receipts": "Edit" })
    ).toBe(false);
  });

  it("with nothing required, still needs membership of the company", () => {
    expect(hasPermissions(claims, "co2", {})).toBe(true);
    expect(hasPermissions(claims, "co3", {})).toBe(false);
  });
});

describe("permissionsFromScopes", () => {
  it("groups <page>_<action> scopes by page and ignores the rest", () => {
    expect(
      permissionsFromScopes({
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

describe("permissionsFromClaims", () => {
  it("resolves get_claims grants for the company", () => {
    const permissions = permissionsFromClaims(
      {
        role: "employee",
        admin: false,
        grants: [
          { subject: "role", module: "Inventory", page: null, level: "Edit" },
          { subject: "person", module: "Sales", page: null, level: "None" },
          { subject: "role", module: "Sales", page: null, level: "Full" }
        ],
        portal: {}
      },
      "co1"
    );
    // A module grant covers every page of the module.
    expect(
      hasPermissions(permissions, "co1", { "inventory.receipts": "Edit" })
    ).toBe(true);
    expect(
      hasPermissions(permissions, "co1", { "inventory.shipments": "Edit" })
    ).toBe(true);
    expect(
      hasPermissions(permissions, "co1", { "inventory.receipts": "Full" })
    ).toBe(false);
    // The person's None override beats the role's Full.
    expect(hasPermissions(permissions, "co1", { "sales.quotes": "View" })).toBe(
      false
    );
  });

  it("checks a page against its own grant before the module's", () => {
    const permissions = permissionsFromClaims(
      {
        role: "employee",
        admin: false,
        grants: [
          { subject: "role", module: "Parts", page: null, level: "View" },
          {
            subject: "role",
            module: "Parts",
            page: "parts.tools",
            level: "Edit"
          }
        ],
        portal: {}
      },
      "co1"
    );
    expect(hasPermissions(permissions, "co1", { "parts.tools": "Edit" })).toBe(
      true
    );
    expect(hasPermissions(permissions, "co1", { "parts.parts": "Edit" })).toBe(
      false
    );
    expect(hasPermissions(permissions, "co1", { "parts.parts": "View" })).toBe(
      true
    );
  });

  it("reads malformed claims as no access", () => {
    const permissions = permissionsFromClaims({ grants: "nope" }, "co1");
    expect(hasPermissions(permissions, "co1", {})).toBe(false);
  });
});

describe("rowRule and anyOfRule", () => {
  it("take their cases from the pages that share the table", () => {
    expect(rowRule("item", "Edit", { id: "itemId" })).toEqual({
      row: {
        id: "itemId",
        from: "item",
        cases: [
          { column: "type", equals: "Part", then: { "parts.parts": "Edit" } },
          {
            column: "type",
            equals: "Material",
            then: { "parts.materials": "Edit" }
          },
          { column: "type", equals: "Tool", then: { "parts.tools": "Edit" } },
          {
            column: "type",
            equals: "Consumable",
            then: { "parts.consumables": "Edit" }
          },
          {
            column: "type",
            equals: "Service",
            then: { "parts.services": "Edit" }
          }
        ]
      }
    });
    // A page whose `where` has no value picks the rows where the column is set.
    expect(rowRule("memo", "View", { id: "memoId" }).row.cases).toEqual([
      { column: "supplierId", then: { "invoicing.supplierCredits": "View" } },
      { column: "customerId", then: { "invoicing.creditMemos": "View" } }
    ]);
    expect(anyOfRule("memo", "Create")).toEqual({
      anyOf: [
        { "invoicing.supplierCredits": "Create" },
        { "invoicing.creditMemos": "Create" }
      ]
    });
  });

  it("refuse a path that does not end at the shared table", () => {
    expect(() =>
      rowRule("item", "View", {
        id: "id",
        from: "supplierPart",
        path: [["supplierId", "supplier"]]
      })
    ).toThrow("The path of a rule on item must end at item, not supplier");
    expect(() => rowRule("job", "View", { id: "id" })).toThrow(
      "job is not a table several pages share"
    );
  });
});

describe("a row rule", () => {
  const rule = rowRule("item", "Edit", { id: "itemId" });
  const memo = rowRule("memo", "Edit", { id: "memoId" });

  it("names the ids in its field: one, or a list without repeats", () => {
    expect(resolvePermissions(rule, { itemId: "i1" })).toEqual({
      row: rule.row,
      ids: ["i1"]
    });
    const list = rowRule("item", "View", { id: "ids" });
    expect(resolvePermissions(list, { ids: ["i1", "i2", "i1"] })).toEqual({
      row: list.row,
      ids: ["i1", "i2"]
    });
  });

  it("refuses an empty list, or a field with no id, as invalid input", () => {
    const list = rowRule("item", "View", { id: "ids" });
    const invalid = (input: unknown) => () =>
      resolvePermissions(list, input as { ids: string[] });
    expect(invalid({ ids: [] })).toThrow(InvalidInputError);
    expect(invalid({ ids: [] })).toThrow(
      "Invalid input — ids: expected an id or a list of ids"
    );
    expect(invalid({})).toThrow(InvalidInputError);
    expect(invalid({ ids: [1] })).toThrow(InvalidInputError);
  });

  it("requires the page of the case a row matches by value", () => {
    expect(
      requirementOfRows({ row: rule.row, ids: ["i1"] }, [
        { id: "i1", type: "Tool" }
      ])
    ).toEqual({ "parts.tools": "Edit" });
  });

  it("requires every row's page for a list", () => {
    expect(
      requirementOfRows({ row: rule.row, ids: ["i1", "i2"] }, [
        { id: "i1", type: "Tool" },
        { id: "i2", type: "Part" }
      ])
    ).toEqual({ "parts.tools": "Edit", "parts.parts": "Edit" });
  });

  it("matches a case without a value when its column is set", () => {
    expect(
      requirementOfRows({ row: memo.row, ids: ["m1"] }, [
        { id: "m1", supplierId: null, customerId: "c1" }
      ])
    ).toEqual({ "invoicing.creditMemos": "Edit" });
    expect(
      requirementOfRows({ row: memo.row, ids: ["m2"] }, [
        { id: "m2", supplierId: "s1", customerId: null }
      ])
    ).toEqual({ "invoicing.supplierCredits": "Edit" });
  });

  it("refuses an id with no row as not found", () => {
    expect(() =>
      requirementOfRows({ row: rule.row, ids: ["i1", "i2"] }, [
        { id: "i1", type: "Part" }
      ])
    ).toThrow(new NotFoundError("item i2 was not found"));
  });

  it("refuses a row no case matches: a Fixture has no page", () => {
    expect(() =>
      requirementOfRows({ row: rule.row, ids: ["i1"] }, [
        { id: "i1", type: "Fixture" }
      ])
    ).toThrow(ForbiddenError);
  });
});

describe("meetsRequirement", () => {
  const tools: ModulePermissions = {
    "parts.tools": { ...none, view: ["co1"], create: ["co1"], update: ["co1"] }
  };

  it("passes an anyOf rule when one entry holds, and refuses none", () => {
    const rule = anyOfRule("item", "Edit");
    expect(meetsRequirement(tools, "co1", rule)).toBe(true);
    expect(meetsRequirement(tools, "co2", rule)).toBe(false);
    expect(meetsRequirement(tools, "co1", anyOfRule("item", "Full"))).toBe(
      false
    );
    expect(meetsRequirement(tools, "co1", { anyOf: [] })).toBe(false);
  });

  it("checks a page gate as hasPermissions does", () => {
    expect(meetsRequirement(tools, "co1", { "parts.tools": "Edit" })).toBe(
      true
    );
    expect(meetsRequirement(tools, "co1", { "parts.parts": "View" })).toBe(
      false
    );
  });
});
