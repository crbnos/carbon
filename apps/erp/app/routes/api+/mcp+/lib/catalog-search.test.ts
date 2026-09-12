import type { ManifestEntry } from "@carbon/api";
import { describe, expect, test } from "vitest";
import {
  collectFieldNames,
  createCatalogSearch,
  expandQueryTerm,
  splitWords
} from "./catalog-search";
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
