import { type AgentDoc, agentDocs } from "@carbon/content/agent-kb";
import { DOCS_URL, docUrl } from "@carbon/content/links";
import { createDocSearch } from "@carbon/ee/mcp";

// The docs site mirrors the corpus slug structure, except that an index page is served at
// its folder (`docs/integrations`, not `docs/integrations/index`). NEVER surface the raw
// slug / file path to the user — always the public URL.
const pagePath = (slug: string) => slug.replace(/(^|\/)index$/, "");
const byPath = new Map(agentDocs.map((d) => [pagePath(d.slug), d]));
const docSearch = createDocSearch(agentDocs);

// Every tool result lands in the model's context and is re-sent on each later step, so
// both tools return bounded text: search_docs a snippet per section, read_doc one section,
// a short page whole, or a long page's intro plus its section links.
const SNIPPET_CHARS = 280;
const FULL_PAGE_CHARS = 12_000;

const sectionUrl = (doc: AgentDoc, anchor: string | null) =>
  `${docUrl(pagePath(doc.slug))}${anchor ? `#${anchor}` : ""}`;

function snippet(markdown: string): string {
  const text = markdown
    .replace(/^#{2,3}\s+[^\n]*\n?/, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > SNIPPET_CHARS
    ? `${text.slice(0, SNIPPET_CHARS)}…`
    : text;
}

/** Ranked search over every doc section (the MCP catalog's engine and aliases). */
export async function searchDocs({
  query,
  limit = 5
}: {
  query: string;
  limit?: number;
}) {
  const hits = await docSearch(query, limit);
  return hits.map(({ doc, section }) => ({
    title: doc.title,
    ...(section.heading ? { section: section.heading } : {}),
    url: sectionUrl(doc, section.anchor),
    snippet: snippet(section.markdown)
  }));
}

/**
 * Read a doc by its public URL (as returned by search_docs). A `#section` URL returns that
 * section; a page URL returns the page, or for a long page its intro and section links.
 */
export function readDoc({ url }: { url: string }) {
  const [location = "", anchor] = url
    .replace(`${DOCS_URL}/`, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .split("#");
  const path = pagePath(
    location.replace(/\?.*$/, "").replace(/^\/+|\/+$/g, "")
  );
  const doc = byPath.get(path);
  if (!doc) return { error: `Doc not found: ${url}` };

  const header = `# ${doc.title}\n\n${
    doc.description ? `> ${doc.description}\n\n` : ""
  }`;

  const section = anchor
    ? doc.sections.find((s) => s.anchor === anchor)
    : undefined;
  if (section) {
    return {
      url: sectionUrl(doc, section.anchor),
      content: `${header}${section.markdown}\n`
    };
  }

  if (doc.markdown.length <= FULL_PAGE_CHARS) {
    return { url: docUrl(path), content: `${header}${doc.markdown}\n` };
  }

  const intro = doc.sections.find((s) => s.heading === null)?.markdown;
  const contents = doc.sections
    .filter((s) => s.anchor)
    .map((s) => `- ${s.heading}: ${sectionUrl(doc, s.anchor)}`)
    .join("\n");
  return {
    url: docUrl(path),
    content: `${header}${intro ? `${intro}\n\n` : ""}This page is long. Read the section you need with read_doc and its URL:\n\n${contents}\n`
  };
}
