// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildOperationCatalog,
  classify,
  inputJsonSchema,
  publishedPermission
} from "./catalog.server";
import { defineServiceFn } from "./service-fn.server";

const noop = async () => ({ ok: true });

const sales = {
  getCustomers: defineServiceFn({
    publish: true,
    title: "Get customers",
    description: "Every customer of the company.",
    input: z.looseObject({
      search: z.string().optional().describe("Matches the name"),
      limit: z.number().int().optional(),
      offset: z.number().int().optional()
    }),
    permission: { view: "sales" },
    run: noop
  }),
  deleteQuote: defineServiceFn({
    publish: true,
    title: "Delete a quote.",
    input: z.object({ id: z.string() }),
    permission: { delete: "sales" },
    run: noop
  }),
  closeQuote: defineServiceFn({
    publish: "destructive",
    title: "Close a quote",
    input: z.object({ id: z.string() }),
    permission: { update: "sales" },
    run: noop
  }),
  getMyAccount: defineServiceFn({
    publish: "read",
    title: "Get the caller's account",
    input: z.object({}),
    permission: {},
    run: noop
  }),
  convertQuote: defineServiceFn({
    publish: true,
    title: "Convert a quote",
    input: z.object({ id: z.string(), notes: z.string().default("") }),
    permission: { create: ["sales", "production"], update: "sales" },
    run: noop
  }),
  internalOnly: defineServiceFn({
    input: z.object({}),
    permission: { update: "sales" },
    run: noop
  }),
  SomeType: undefined as unknown
};

describe("buildOperationCatalog", () => {
  const catalog = buildOperationCatalog({ sales });
  const byName = new Map(catalog.map((op) => [op.name, op]));

  it("publishes only the functions with `publish`, named module_const", () => {
    expect([...byName.keys()]).toEqual([
      "sales_getCustomers",
      "sales_deleteQuote",
      "sales_closeQuote",
      "sales_getMyAccount",
      "sales_convertQuote"
    ]);
    expect(byName.get("sales_getCustomers")?.serviceFn.path).toEqual([
      "sales",
      "getCustomers"
    ]);
    expect(byName.get("sales_getCustomers")?.fn).toBe(sales.getCustomers);
  });

  it("classifies from the permission, with the two overrides", () => {
    expect(byName.get("sales_getCustomers")?.classification).toBe("READ");
    expect(byName.get("sales_deleteQuote")?.classification).toBe("DESTRUCTIVE");
    expect(byName.get("sales_closeQuote")?.classification).toBe("DESTRUCTIVE");
    expect(byName.get("sales_getMyAccount")?.classification).toBe("READ");
    expect(byName.get("sales_convertQuote")?.classification).toBe("WRITE");
  });

  it("publishes one module's permission, and null across modules or for membership", () => {
    expect(byName.get("sales_getCustomers")?.permission).toEqual({
      module: "sales",
      actions: ["view"]
    });
    expect(byName.get("sales_getMyAccount")?.permission).toEqual({
      module: null,
      actions: []
    });
    expect(byName.get("sales_convertQuote")?.permission).toEqual({
      module: null,
      actions: []
    });
  });

  it("writes the description as the title sentence then the prose", () => {
    expect(byName.get("sales_getCustomers")?.description).toBe(
      "Get customers.\n\nEvery customer of the company."
    );
    expect(byName.get("sales_deleteQuote")?.title).toBe("Delete a quote.");
    expect(byName.get("sales_deleteQuote")?.description).toBe(
      "Delete a quote."
    );
  });

  it("reads paginates from a limit + offset input", () => {
    expect(byName.get("sales_getCustomers")?.paginates).toBe(true);
    expect(byName.get("sales_deleteQuote")?.paginates).toBe(false);
  });

  it("derives the input schema from the validator, lazily", () => {
    const loose = byName.get("sales_getCustomers")?.schema;
    expect(loose).toMatchObject({
      type: "object",
      properties: {
        search: { type: "string", description: "Matches the name" }
      }
    });
    expect(loose).toHaveProperty("additionalProperties");
    expect(loose).not.toHaveProperty("$schema");
    // A paged loose read also takes the list filters and sorts.
    expect(loose?.properties).toHaveProperty("filters.items.required", [
      "column",
      "operator",
      "value"
    ]);
    expect(loose?.properties).toHaveProperty("sorts.items.required", [
      "sortBy",
      "sortAsc"
    ]);
    const strict = byName.get("sales_convertQuote")?.schema;
    expect(strict).not.toHaveProperty("additionalProperties");
    // A defaulted field is not required of the caller.
    expect(strict?.required).toEqual(["id"]);
  });
});

describe("refusals", () => {
  it("needs a title", () => {
    const untitled = defineServiceFn({
      publish: true,
      title: "  ",
      input: z.object({}),
      permission: { view: "sales" },
      run: noop
    });
    expect(() => buildOperationCatalog({ sales: { untitled } })).toThrow(
      /needs a title/
    );
  });

  it("refuses a system or keyed permission", () => {
    expect(() => publishedPermission("x", "system")).toThrow(/system-only/);
    expect(() => publishedPermission("x", { by: "table", rules: {} })).toThrow(
      /keyed/
    );
  });

  it("refuses a read that writes", () => {
    expect(() => classify("x", "read", ["view", "update"])).toThrow(
      /requires update/
    );
  });
});

describe("inputJsonSchema", () => {
  it("marks optional and defaulted fields as not required and keeps enums", () => {
    const schema = inputJsonSchema(
      z.object({
        id: z.string(),
        status: z.enum(["Draft", "Open"]).optional(),
        qty: z.number().default(1)
      })
    );
    expect(schema.required).toEqual(["id"]);
    expect(schema).toMatchObject({
      properties: { status: { enum: ["Draft", "Open"] } }
    });
  });
});

describe("buildOperationCatalog: declared outputs", () => {
  const customerRow = z
    .object({ id: z.string(), name: z.string(), notes: z.string().nullable() })
    .meta({ table: "customer" });
  const customersView = z
    .object({ id: z.string(), name: z.string() })
    .meta({ table: "customer", view: "customers" });
  const registry = {
    sales: {
      getCustomers: defineServiceFn({
        publish: true,
        title: "Get customers",
        input: z.looseObject({
          limit: z.number().int().optional(),
          offset: z.number().int().optional()
        }),
        permission: { view: "sales" },
        output: z.array(customersView),
        run: noop
      }),
      getCustomersList: defineServiceFn({
        publish: true,
        title: "Get the customer list",
        input: z.object({}),
        permission: { view: "sales" },
        output: z.array(
          customerRow.pick({ id: true, name: true }).meta({ table: "customer" })
        ),
        run: noop
      }),
      getCustomer: defineServiceFn({
        publish: true,
        title: "Get a customer",
        input: z.object({ id: z.string().describe("The customer") }),
        permission: { view: "sales" },
        output: customerRow.nullable(),
        run: noop
      }),
      createQuote: defineServiceFn({
        publish: true,
        title: "Create a quote",
        input: z.object({
          customerId: z.string(),
          notes: z.string().optional()
        }),
        permission: { create: "sales" },
        output: z.object({ id: z.string() }),
        run: noop
      }),
      countQuotes: defineServiceFn({
        publish: true,
        title: "Count quotes",
        input: z.object({}),
        permission: { view: "sales" },
        run: noop
      })
    }
  };
  const byName = new Map(
    buildOperationCatalog(registry).map((op) => [op.name, op])
  );

  it("publishes the declared output as the response schema, without source meta", () => {
    expect(byName.get("sales_getCustomer")?.responseSchema).toEqual({
      anyOf: [
        {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            notes: { type: ["string", "null"] }
          },
          required: ["id", "name", "notes"]
        },
        { type: "null" }
      ]
    });
    expect(byName.get("sales_getCustomers")?.responseSchema).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"]
      }
    });
    expect(byName.get("sales_countQuotes")?.responseSchema).toBeUndefined();
  });

  it("points an id input at the list that returns that table's ids", () => {
    // A `…List` with no inputs outranks the paged list for the same table.
    expect(byName.get("sales_createQuote")?.lookups).toEqual({
      customerId: ["sales_getCustomersList"]
    });
    // `id` is the operation's own row table.
    expect(byName.get("sales_getCustomer")?.lookups).toEqual({
      id: ["sales_getCustomersList"]
    });
    expect(byName.get("sales_getCustomersList")?.lookups).toBeUndefined();
    expect(byName.get("sales_getCustomer")?.schema).toMatchObject({
      properties: {
        id: { description: "The customer. See sales_getCustomersList." }
      }
    });
    expect(byName.get("sales_createQuote")?.schema).toMatchObject({
      properties: { customerId: { description: "See sales_getCustomersList." } }
    });
  });
});
