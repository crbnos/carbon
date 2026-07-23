import manifest from "./kb/manifest.json";

type DocEntry = {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  headings: string[];
};

const docs = (manifest as { docs: DocEntry[] }).docs;

// The docs site mirrors the kb slug structure 1:1, so the public URL is just the base
// + slug. NEVER surface the raw slug / file path to the user — always this URL.
const DOCS_BASE = "https://docs.carbon.ms";
const docUrl = (slug: string) => `${DOCS_BASE}/${slug}`;

// Bundle every generated .md into the server build so reads work in the container
// (no fs / docs-app dependency). Keyed by e.g. "./kb/docs/reference/jobs.md".
const files = import.meta.glob("./kb/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;

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
  return docs
    .map((d) => {
      const meta =
        `${d.title} ${d.description} ${d.keywords.join(" ")} ${d.headings.join(" ")}`.toLowerCase();
      const body = (files[`./kb/${d.slug}.md`] ?? "").toLowerCase();
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
    .replace(`${DOCS_BASE}/`, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^\/+/, "");
  const content = files[`./kb/${slug}.md`];
  if (!content) return { error: `Doc not found: ${url}` };
  return { url: docUrl(slug), content };
}
