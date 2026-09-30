import { agentDocs } from "@carbon/content/agent-kb";
import { DOCS_URL, docUrl } from "@carbon/content/links";
import { createDocSearch } from "@carbon/ee/mcp";

// The docs site mirrors the corpus slug structure 1:1, so the public URL is just the base
// + slug. NEVER surface the raw slug / file path to the user — always this URL.
const bySlug = new Map(agentDocs.map((d) => [d.slug, d]));
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
    url: docUrl(d.slug)
  }));
}

/** Read the full markdown for a doc by its public URL (as returned by search_docs). */
export function readDoc({ url }: { url: string }) {
  const slug = url
    .replace(`${DOCS_URL}/`, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^\/+/, "");
  const doc = bySlug.get(slug);
  if (!doc) return { error: `Doc not found: ${url}` };
  const content = `# ${doc.title}\n\n${
    doc.description ? `> ${doc.description}\n\n` : ""
  }${doc.markdown}\n`;
  return { url: docUrl(slug), content };
}
