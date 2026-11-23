// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ManifestEntry } from "@carbon/api";
import {
  collectFieldNames,
  createCatalogSearch,
  createNameComparator,
  expandQueryTerm,
  splitWords
} from "@carbon/ee/mcp";
import { describe, expect, test } from "vitest";
import toolMetadata from "./tool-metadata.json";

const tools = toolMetadata.tools as unknown as ManifestEntry[];
const catalog = createCatalogSearch(tools);

const page = { limit: 20, offset: 0 };

describe("splitWords", () => {
  test("splits camelCase and separators", () => {
    expect(splitWords("getJobOperationsList")).toBe("get job operations list");
    expect(splitWords("sales_getCustomers")).toBe("sales get customers");
    expect(splitWords("HTMLParser")).toBe("html parser");
  });
});

describe("expandQueryTerm", () => {
  test("keeps the original tokens alongside camel-split words", () => {
    const term = expandQueryTerm("getCustomers").split(" ");
    expect(term).toContain("getcustomers");
    expect(term).toContain("customers");
  });

  test("expands domain aliases additively", () => {
    const term = expandQueryTerm("RMA status").split(" ");
    expect(term).toContain("rma");
    expect(term).toContain("return");
    expect(term).toContain("status");
  });
});

describe("collectFieldNames", () => {
  test("walks nested objects, arrays and unions", () => {
    const fields = collectFieldNames({
      type: "object",
      properties: {
        id: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: { unitPrice: { type: "number" } }
          }
        },
        variant: {
          anyOf: [{ type: "object", properties: { jobId: { type: "string" } } }]
        }
      }
    });
    expect([...fields].sort()).toEqual([
      "id",
      "jobId",
      "lines",
      "unitPrice",
      "variant"
    ]);
  });
});

describe("catalog search", () => {
  test("ranks the exact name match first", async () => {
    const { matches } = await catalog.search({
      query: "getCustomers",
      ...page
    });
    expect(matches[0]?.name).toBe("sales_getCustomers");
  });

  test("multi-word queries do not require a contiguous substring", async () => {
    const { matches, total } = await catalog.search({
      query: "job operation",
      ...page
    });
    expect(total).toBeGreaterThan(0);
    expect(matches.some((t) => t.name.includes("JobOperation"))).toBe(true);
  });

  test("finds return tools for the RMA abbreviation", async () => {
    const { matches } = await catalog.search({ query: "rma", ...page });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((t) => t.name.toLowerCase().includes("return"))).toBe(
      true
    );
  });

  test("finds storage units for the renamed shelf concept", async () => {
    const { matches } = await catalog.search({ query: "shelf", ...page });
    expect(matches.some((t) => t.name.includes("StorageUnit"))).toBe(true);
  });

  test("matches schema field names", async () => {
    const { matches, total } = await catalog.search({
      query: "supersession",
      ...page
    });
    expect(total).toBeGreaterThan(0);
    expect(matches.length).toBeGreaterThan(0);
  });

  test("second pass tolerates typos", async () => {
    const { matches } = await catalog.search({ query: "cutomers", ...page });
    expect(matches.some((t) => t.name.toLowerCase().includes("customer"))).toBe(
      true
    );
  });

  test("module filter keeps substring semantics", async () => {
    const { total } = await catalog.search({ module: "sale", ...page });
    expect(total).toBe(tools.filter((t) => t.module === "sales").length);
  });

  test("classification filter composes with a query", async () => {
    const { matches } = await catalog.search({
      query: "customer",
      classification: "READ",
      ...page
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((t) => t.classification === "READ")).toBe(true);
  });

  test("unknown module filter returns nothing rather than everything", async () => {
    const { matches, total } = await catalog.search({
      module: "nope",
      ...page
    });
    expect(matches).toEqual([]);
    expect(total).toBe(0);
  });

  test("filter-only search keeps metadata order and paginates", async () => {
    const first = await catalog.search({ limit: 3, offset: 0 });
    expect(first.matches.map((t) => t.name)).toEqual(
      tools.slice(0, 3).map((t) => t.name)
    );
    expect(first.total).toBe(tools.length);
  });

  test("query pagination pages ranked results without overlap", async () => {
    const a = await catalog.search({ query: "customer", limit: 5, offset: 0 });
    const b = await catalog.search({ query: "customer", limit: 5, offset: 5 });
    const overlap = a.matches.filter((t) =>
      b.matches.some((u) => u.name === t.name)
    );
    expect(overlap).toEqual([]);
  });
});

describe("ranking by name", () => {
  const top = async (query: string) =>
    (await catalog.search({ query, limit: 3, offset: 0 })).matches.map(
      (tool) => tool.name
    );

  test("an exact tool name comes first, with or without its module", async () => {
    expect((await top("inventory_getInventoryItems"))[0]).toBe(
      "inventory_getInventoryItems"
    );
    expect((await top("getInventoryItems"))[0]).toBe(
      "inventory_getInventoryItems"
    );
  });

  test("the tool whose name covers every query word beats repeated common words", async () => {
    expect((await top("inventory items"))[0]).toBe(
      "inventory_getInventoryItems"
    );
    expect((await top("get inventory items"))[0]).toBe(
      "inventory_getInventoryItems"
    );
  });

  test("a bare noun is a lookup: reads before writes", async () => {
    expect((await top("bom"))[0]).toBe("items_getMethodMaterials");
    expect((await top("jobs"))[0]).toBe("production_getJobs");
  });

  test("an action word picks that action, synonyms included", async () => {
    expect((await top("delete customer"))[0]).toBe("sales_deleteCustomer");
    expect((await top("create purchase order"))[0]).toBe(
      "purchasing_insertPurchaseOrder"
    );
  });

  test("industry phrases and plurals reach Carbon's names", async () => {
    expect((await top("work orders"))[0]).toBe("production_getJobs");
    expect((await top("vendors"))[0]).toBe("purchasing_getSuppliers");
    for (const query of ["nonconformance items", "non-conformance items"]) {
      expect(await top(query)).toContain("quality_getIssueItems");
    }
  });

  test("a database-paged tool beats a List that reads the whole table", async () => {
    expect((await top("list customers"))[0]).toBe("sales_getCustomers");
    expect((await top("list sales orders"))[0]).toBe("sales_getSalesOrders");
  });

  test("filters still apply to an exact name", async () => {
    const { matches } = await catalog.search({
      query: "getInventoryItems",
      module: "sales",
      limit: 5,
      offset: 0
    });
    expect(matches.map((t) => t.name)).not.toContain(
      "inventory_getInventoryItems"
    );
  });
});

describe("createNameComparator", () => {
  const entry = (
    name: string,
    classification: ManifestEntry["classification"] = "READ"
  ) => ({ ...tools[0]!, name, classification }) as ManifestEntry;
  const actions = new Set(["get", "delete", "insert"]);

  test("prefers the tighter name when coverage ties", () => {
    const compare = createNameComparator("job", actions)!;
    const ranked = [
      entry("production_getJobOperations"),
      entry("production_getJob")
    ].sort(compare);
    expect(ranked.map((t) => t.name)).toEqual([
      "production_getJob",
      "production_getJobOperations"
    ]);
  });

  test("puts an exact name first, with or without its module", () => {
    const compare = createNameComparator("getJob", actions)!;
    expect(
      compare(entry("production_getJob"), entry("production_getJobs"))
    ).toBeLessThan(0);
  });

  test("leaves the BM25 order when the query has no usable words", () => {
    expect(createNameComparator("the of", actions)).toBe(null);
  });

  test("a document verb ranks that document's tools first", async () => {
    const { matches } = await catalog.search({
      query: "receive a purchase order",
      ...page
    });
    expect(matches.slice(0, 4).every((tool) => /Receipt/.test(tool.name))).toBe(
      true
    );
  });
});
