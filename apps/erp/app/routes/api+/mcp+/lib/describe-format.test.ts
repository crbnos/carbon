// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ManifestEntry } from "@carbon/api";
import {
  closestToolNames,
  deriveNameDescription,
  formatParamSummary,
  formatSchemaType,
  formatSearchResults,
  formatToolDescription,
  getServerInstructions,
  MCP_DEFAULT_LIMIT,
  paginatingSibling,
  searchLineDescription
} from "@carbon/ee/mcp";
import { describe, expect, test } from "vitest";
import toolMetadata from "./tool-metadata.json";

const baseTool: ManifestEntry = {
  name: "sales_getCustomer",
  module: "sales",
  classification: "READ",
  description: "get customer",
  permission: { module: "sales", actions: ["view"] },
  paginates: true,
  serviceFn: { path: ["sales", "getCustomer"] },
  schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      includeContacts: { type: "boolean" },
      status: { type: "string" }
    },
    required: ["id"]
  },
  responseSchema: {
    type: "object",
    properties: { id: { type: "string" }, name: { type: "string" } }
  }
};

describe("deriveNameDescription", () => {
  test("mirrors the generator's name-derived description", () => {
    expect(deriveNameDescription("sales_getCustomers")).toBe("get customers");
    expect(deriveNameDescription("production_upsertJobMaterial")).toBe(
      "upsert job material"
    );
  });
});

describe("formatParamSummary", () => {
  test("spells out required params and counts optionals", () => {
    expect(formatParamSummary(baseTool)).toBe("(id, +2 optional)");
  });

  test("renders an argless tool as empty parens", () => {
    expect(
      formatParamSummary({
        ...baseTool,
        schema: { type: "object", properties: {} }
      })
    ).toBe("()");
  });
});

describe("formatToolDescription", () => {
  test("prints the full contract including the response schema", () => {
    const text = formatToolDescription(baseTool, { isList: false });
    expect(text.split("\n").slice(0, 3)).toEqual([
      "sales_getCustomer [READ]",
      "get customer",
      "Permission: sales_view"
    ]);
    expect(text).toContain(
      "Input: { id: string; includeContacts?: boolean; status?: string }"
    );
    expect(text).toContain(
      "Returns (null fields are omitted): { id?: string; name?: string }"
    );
    expect(text).not.toContain("List operation:");
  });

  test("marks paginating list operations with the default page size", () => {
    const text = formatToolDescription(baseTool, { isList: true });
    expect(text).toContain(
      `List operation: pages with limit/offset (default limit ${MCP_DEFAULT_LIMIT})`
    );
  });

  test("is honest about fetchAll list operations and steers to the sibling", () => {
    const text = formatToolDescription(
      { ...baseTool, name: "sales_getCustomersList", paginates: false },
      { isList: true, sibling: "sales_getCustomers" }
    );
    expect(text).toContain(
      `List operation: full-set read; the response is paged with limit/offset (default limit ${MCP_DEFAULT_LIMIT}) — for database-side paging use sales_getCustomers`
    );
  });

  test("omits the steer when no paginating sibling exists", () => {
    const text = formatToolDescription(
      { ...baseTool, paginates: false },
      { isList: true, sibling: null }
    );
    expect(text).toContain("full-set read");
    expect(text).not.toContain("database-side paging use");
  });

  test("omits the permission line for key-only operations", () => {
    const text = formatToolDescription(
      { ...baseTool, permission: { module: null, actions: ["view"] } },
      { isList: false }
    );
    expect(text).not.toContain("Permission:");
  });

  test("omits the response schema section when none was derived", () => {
    const text = formatToolDescription(
      { ...baseTool, responseSchema: undefined },
      { isList: false }
    );
    expect(text).not.toContain("Returns");
  });
});

describe("formatSchemaType", () => {
  test("renders nullable, enum, array and nested object types", () => {
    expect(
      formatSchemaType({
        type: ["array", "null"],
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["Draft", "Posted"] },
            tags: { type: "array", items: { type: "string" } },
            lines: {
              type: "array",
              items: { anyOf: [{ type: "string" }, { type: "number" }] }
            },
            "odd-key": { type: "integer" },
            note: { type: ["string", "null"], description: "free text" }
          },
          required: ["id", "status"],
          additionalProperties: {}
        }
      })
    ).toBe(
      '{ id: string; status: "Draft" | "Posted"; tags?: string[]; lines?: (string | number)[]; "odd-key"?: number; note?: string | null /* free text */ }[] | null'
    );
  });

  test("renders records, empty schemas and bare objects", () => {
    expect(
      formatSchemaType({
        type: "object",
        additionalProperties: { type: "number" }
      })
    ).toBe("Record<string, number>");
    expect(formatSchemaType({})).toBe("unknown");
    expect(formatSchemaType({ type: "object" })).toBe("object");
  });

  test("is far shorter than the JSON Schema across the manifest", () => {
    let json = 0;
    let typed = 0;
    for (const tool of toolMetadata.tools as unknown as ManifestEntry[]) {
      for (const schema of [tool.schema, tool.responseSchema]) {
        if (!schema) continue;
        json += JSON.stringify(schema).length;
        typed += formatSchemaType(schema).length;
      }
    }
    expect(typed).toBeLessThan(json / 2);
  });
});

describe("formatSearchResults", () => {
  const tool = (
    name: string,
    description: string,
    classification: ManifestEntry["classification"] = "READ"
  ) => ({ ...baseTool, name, description, classification });

  test("lists tools in rank order, one line each, with the next page", () => {
    const text = formatSearchResults(
      [
        tool("sales_getCustomer", "get customer"),
        tool("inventory_postReceipt", "Post a receipt.", "WRITE"),
        tool(
          "sales_deleteCustomer",
          "Remove a customer and its contacts.",
          "DESTRUCTIVE"
        )
      ],
      40,
      0
    );
    expect(text.split("\n")).toEqual([
      "Found 40 tools, ranked by relevance (showing 1-3; next page: offset 3):",
      "sales_getCustomer [READ] (id, +2 optional)",
      "inventory_postReceipt [WRITE] (id, +2 optional)",
      "sales_deleteCustomer [DESTRUCTIVE] (id, +2 optional) — Remove a customer and its contacts."
    ]);
  });

  test("omits the page note when every match is shown", () => {
    expect(formatSearchResults([tool("sales_getCustomer", "x")], 1, 0)).toBe(
      "Found 1 tool, ranked by relevance:\nsales_getCustomer [READ] (id, +2 optional) — x"
    );
  });
});

describe("closestToolNames", () => {
  const names = (toolMetadata.tools as unknown as ManifestEntry[]).map(
    (tool) => tool.name
  );

  test("puts the real name first for a near-typo", () => {
    expect(closestToolNames("inventory_getInventoryItem", names)[0]).toBe(
      "inventory_getInventoryItems"
    );
    expect(closestToolNames("sales_getCustomr", names)[0]).toBe(
      "sales_getCustomer"
    );
  });

  test("suggests nothing for a name nowhere near a tool", () => {
    expect(closestToolNames("weather_forecast", names)).toEqual([]);
  });
});

describe("searchLineDescription", () => {
  test("keeps the first paragraph of a long description", () => {
    expect(
      searchLineDescription({
        name: "inventory_getSerialUnitCosts",
        description: "Value an item's serial units on hand.\n\nWhat each unit…"
      })
    ).toBe("Value an item's serial units on hand.");
  });

  test("skips a description that restates the name", () => {
    for (const [name, description] of [
      ["sales_getCustomers", "get customers"],
      ["inventory_getReceipt", "Get receipt."],
      ["inventory_postReceipt", "Post a receipt."]
    ]) {
      expect(searchLineDescription({ name, description })).toBe(null);
    }
  });

  test("keeps a description that says more than the name", () => {
    expect(
      searchLineDescription({
        name: "invoicing_postPayment",
        description: "Post a Draft payment."
      })
    ).toBe("Post a Draft payment.");
  });
});

describe("paginatingSibling", () => {
  const catalog = new Map([
    ["sales_getCustomers", { name: "sales_getCustomers", paginates: true }],
    ["items_getPartsList", { name: "items_getPartsList", paginates: false }]
  ]);
  const resolve = (n: string) => catalog.get(n);

  test("resolves getXList to a paginating getX", () => {
    expect(paginatingSibling("sales_getCustomersList", resolve)).toBe(
      "sales_getCustomers"
    );
  });

  test("returns null when the sibling is missing or does not paginate", () => {
    expect(paginatingSibling("items_getWidgetsList", resolve)).toBe(null);
    expect(paginatingSibling("sales_getCustomers", resolve)).toBe(null);
  });
});

describe("getServerInstructions", () => {
  const instructions = getServerInstructions(
    "2026-09-11",
    toolMetadata as unknown as Parameters<typeof getServerInstructions>[1]
  );

  test("lists every module name", () => {
    const modules = [...new Set(toolMetadata.tools.map((t) => t.module))];
    for (const module of modules) {
      expect(instructions).toContain(module);
    }
  });

  test("derives the default page size from the constant", () => {
    expect(instructions).toContain(
      `List reads default to ${MCP_DEFAULT_LIMIT} rows`
    );
  });

  test("documents describe_tool batching", () => {
    expect(instructions).toContain('names: ["sales_getCustomers"');
  });
});
