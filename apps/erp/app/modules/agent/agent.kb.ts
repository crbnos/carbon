import { agentDocs } from "@carbon/content/agent-kb";
import { DOCS_URL, docUrl } from "@carbon/content/links";

// The docs site mirrors the corpus slug structure 1:1, so the public URL is just the base
// + slug. NEVER surface the raw slug / file path to the user — always this URL.
const bySlug = new Map(agentDocs.map((d) => [d.slug, d]));

/** Keyword search over each doc's metadata AND full body; returns the best matches. */
export function searchDocs({
  query,
  limit = 5
}: {
  query: string;
  limit?: number;
}) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return agentDocs
    .map((d) => {
      const meta =
        `${d.title} ${d.description} ${d.keywords.join(" ")} ${d.headings.join(" ")}`.toLowerCase();
      const body = d.markdown.toLowerCase();
      // Metadata hits weigh more than body hits, but a body-only term still counts.
      const score = terms.reduce(
        (s, t) => s + (meta.includes(t) ? 2 : body.includes(t) ? 1 : 0),
        0
      );
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ d }) => ({
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
