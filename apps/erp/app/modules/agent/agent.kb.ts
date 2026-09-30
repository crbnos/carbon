import { agentDocs } from "@carbon/content/agent-kb";
import { DOCS_URL, docUrl } from "@carbon/content/links";
import { createDocSearch } from "@carbon/ee/mcp";

// The docs site mirrors the corpus slug structure, except that an index page is served at
// its folder (`docs/integrations`, not `docs/integrations/index`). NEVER surface the raw
// slug / file path to the user — always the public URL.
const pagePath = (slug: string) => slug.replace(/(^|\/)index$/, "");
const byPath = new Map(agentDocs.map((d) => [pagePath(d.slug), d]));
const docSearch = createDocSearch(agentDocs);

/** Ranked search over every doc (the MCP catalog's engine and aliases); best matches first. */
export async function searchDocs({
  query,
  limit = 5
}: {
  query: string;
  limit?: number;
}) {
  const hits = await docSearch(query, limit);
  return hits.map((d) => ({
    title: d.title,
    description: d.description,
    url: docUrl(pagePath(d.slug))
  }));
}

/** Read the full markdown for a doc by its public URL (as returned by search_docs). */
export function readDoc({ url }: { url: string }) {
  const path = pagePath(
    url
      .replace(`${DOCS_URL}/`, "")
      .replace(/^https?:\/\/[^/]+\//, "")
      .replace(/[?#].*$/, "")
      .replace(/^\/+|\/+$/g, "")
  );
  const doc = byPath.get(path);
  if (!doc) return { error: `Doc not found: ${url}` };
  const content = `# ${doc.title}\n\n${
    doc.description ? `> ${doc.description}\n\n` : ""
  }${doc.markdown}\n`;
  return { url: docUrl(path), content };
}
