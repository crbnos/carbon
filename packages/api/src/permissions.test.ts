// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { holdsGate } from "@carbon/database/access";
import { describe, expect, it } from "vitest";
import { ForbiddenError, InvalidInputError, NotFoundError } from "./errors";
import {
  anyOfRule,
  type PermissionRule,
  readGate,
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

  it("take a child table's path from the registry", () => {
    expect(
      rowRule("item", "Edit", { id: "id", from: "methodOperationStep" }).row
        .path
    ).toEqual([
      ["operationId", "methodOperation"],
      ["makeMethodId", "makeMethod"],
      ["itemId", "item"]
    ]);
    expect(() =>
      rowRule("item", "Edit", { id: "id", from: "salesOrderLine" })
    ).toThrow("must end at item, not salesOrderLine");
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

describe("readGate", () => {
  const claimsFor = (page: string, action: "view" | "create" | "update") => ({
    [page]: {
      view: ["c1"],
      create: action === "view" ? [] : ["c1"],
      update: action === "update" ? ["c1"] : [],
      delete: []
    }
  });

  it("lets View on any page of the module pass a read on one page", () => {
    const gate = readGate({ "inventory.receipts": "View" } as const);
    expect(
      holdsGate(claimsFor("inventory.shipments", "view"), gate as never, "c1")
    ).toBe(true);
    expect(
      holdsGate(claimsFor("sales.quotes", "view"), gate as never, "c1")
    ).toBe(false);
  });

  it("leaves a write on one page as written", () => {
    const gate = readGate({ "inventory.receipts": "Edit" } as const);
    expect(gate).toEqual({ "inventory.receipts": "Edit" });
    expect(
      holdsGate(claimsFor("inventory.shipments", "update"), gate, "c1")
    ).toBe(false);
  });

  it("widens each value of a keyed rule, and each page of a list", () => {
    const keyed = readGate({
      by: "side",
      rules: {
        a: { "users.employeeTypes": "View" },
        b: { "users.accounts": "Edit" }
      }
    });
    expect(
      holdsGate(
        claimsFor("users.accounts", "view"),
        resolvePermissions(keyed as never, { side: "a" }) as never,
        "c1"
      )
    ).toBe(true);
    expect(resolvePermissions(keyed as never, { side: "b" })).toEqual({
      "users.accounts": "Edit"
    });
    // View on any Parts page reads an item row, as RLS admits.
    const list = anyOfRule("item", "View");
    const units = claimsFor("parts.units", "view");
    expect(holdsGate(units, list as never, "c1")).toBe(false);
    expect(holdsGate(units, readGate(list) as never, "c1")).toBe(true);
  });
});
