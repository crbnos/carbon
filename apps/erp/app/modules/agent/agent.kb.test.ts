import { agentDocs } from "@carbon/content/agent-kb";
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

  it("links an index page at its folder URL, the one the site serves", async () => {
    expect(await top("integrations", 5)).toContain(
      "https://docs.carbon.ms/docs/integrations"
    );
    for (const doc of agentDocs) {
      const [hit] = await searchDocs({ query: doc.title, limit: 20 }).then(
        (hits) => hits.filter((h) => h.title === doc.title)
      );
      expect(hit, `"${doc.title}" finds its own page`).toBeDefined();
      expect(hit!.url, doc.slug).not.toMatch(/\/index$/);
    }
  });
});

describe("read_doc", () => {
  it("opens an index page by its folder URL and by the old /index form", () => {
    const folder = readDoc({ url: "https://docs.carbon.ms/docs/integrations" });
    expect(folder).toMatchObject({
      url: "https://docs.carbon.ms/docs/integrations"
    });
    expect(
      readDoc({ url: "https://docs.carbon.ms/docs/integrations/index" })
    ).toEqual(folder);
  });

  it("ignores an anchor, a query and a trailing slash", () => {
    const page = readDoc({ url: "https://docs.carbon.ms/docs/reference/jobs" });
    expect("content" in page).toBe(true);
    expect(
      readDoc({ url: "https://docs.carbon.ms/docs/reference/jobs/#fields" })
    ).toEqual(page);
    expect(readDoc({ url: "/docs/reference/jobs?ref=x" })).toEqual(page);
  });
});
