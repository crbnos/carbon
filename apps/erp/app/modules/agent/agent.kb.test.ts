// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { agentDocs } from "@carbon/content/agent-kb";
import { describe, expect, it } from "vitest";
import { readDoc, searchDocs } from "./agent.kb";

// The first n distinct pages the hits point into (hits link to a section,
// `…/purchase-orders#fields`, and a page may contribute two).
const top = async (query: string, n = 3) =>
  [
    ...new Set(
      (await searchDocs({ query, limit: n * 2 })).map(
        (hit) => hit.url.split("#")[0]
      )
    )
  ].slice(0, n);

// What one read_doc may put into the model's context. The chat model once had an 8k-token
// window, and one whole long page (batching, ~7k tokens) overflowed it.
const READ_BUDGET = 16_000;

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

  it("returns section URLs read_doc can open, with a short snippet", async () => {
    const hits = await searchDocs({ query: "operation batching", limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(readDoc({ url: hit.url })).toMatchObject({ url: hit.url });
      expect(hit.snippet.length).toBeLessThanOrEqual(281);
    }
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
      expect(hit!.url, doc.slug).not.toMatch(/\/index(#|$)/);
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

  it("reads one section by its anchor", () => {
    const page = agentDocs.find((d) => d.slug === "docs/reference/batching")!;
    const section = page.sections.find((s) => s.anchor)!;
    const url = `https://docs.carbon.ms/docs/reference/batching#${section.anchor}`;
    const result = readDoc({ url });
    expect(result).toMatchObject({ url });
    expect((result as { content: string }).content).toContain(section.markdown);
  });

  it("returns a long page as its intro and section links", () => {
    const result = readDoc({
      url: "https://docs.carbon.ms/docs/reference/batching"
    });
    const content = (result as { content: string }).content;
    expect(content).toContain("This page is long");
    expect(content).toContain(
      "https://docs.carbon.ms/docs/reference/batching#"
    );
  });

  it("falls back to the page for an unknown anchor, and ignores a query or trailing slash", () => {
    const page = readDoc({ url: "https://docs.carbon.ms/docs/reference/jobs" });
    expect("content" in page).toBe(true);
    expect(
      readDoc({
        url: "https://docs.carbon.ms/docs/reference/jobs/#no-such-heading"
      })
    ).toEqual(page);
    expect(readDoc({ url: "/docs/reference/jobs?ref=x" })).toEqual(page);
  });

  it("keeps every page and section read within budget", () => {
    const over = agentDocs.flatMap((doc) => {
      const pageUrl = `https://docs.carbon.ms/${doc.slug.replace(/(^|\/)index$/, "")}`;
      const urls = [
        pageUrl,
        ...doc.sections
          .filter((s) => s.anchor)
          .map((s) => `${pageUrl}#${s.anchor}`)
      ];
      return urls.flatMap((url) => {
        const { content = "" } = readDoc({ url }) as { content?: string };
        return content.length > READ_BUDGET
          ? [`${url}: ${content.length}`]
          : [];
      });
    });
    expect(over).toEqual([]);
  });
});
