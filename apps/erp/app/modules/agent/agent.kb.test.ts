import { describe, expect, it } from "vitest";
import { readDoc, searchDocs } from "./agent.kb";

const top = async (query: string, n = 3) =>
  (await searchDocs({ query, limit: n })).map((hit) => hit.url);

describe("search_docs", () => {
  it("expands domain abbreviations the way MCP search_tools does", async () => {
    expect(await top("PO")).toContain(
      "https://docs.carbon.ms/docs/reference/purchase-orders"
    );
    expect(await top("vendor")).toContain(
      "https://docs.carbon.ms/docs/reference/suppliers-and-customers"
    );
  });

  it("forgives a one-letter typo", async () => {
    expect(await top("invoces")).toContain(
      "https://docs.carbon.ms/docs/reference/invoices"
    );
  });

  it("returns nothing for an empty query", async () => {
    expect(await searchDocs({ query: "  " })).toEqual([]);
  });

  it("returns URLs read_doc can open", async () => {
    const [hit] = await searchDocs({ query: "scrap", limit: 1 });
    expect(hit).toBeDefined();
    expect(readDoc({ url: hit!.url })).toMatchObject({ url: hit!.url });
  });
});
