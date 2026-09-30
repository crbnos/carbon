/// <reference types="vite/client" />
import { type CorpusPage, keywords, parsePage } from "./corpus";

// Vite-only: bundles every page's raw MDX into the importing build (the ERP server),
// so the agent needs no fs or docs app at runtime.
const sources = import.meta.glob(["../docs/**/*.mdx", "../guides/**/*.mdx"], {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;

export type AgentDoc = CorpusPage & { keywords: string[] };

/** Every docs page as stripped markdown, sorted by slug (`docs/reference/jobs`). */
export const agentDocs: AgentDoc[] = Object.entries(sources)
  .map(([file, raw]) => {
    const page = parsePage(
      file.replace(/^\.\.\//, "").replace(/\.mdx$/, ""),
      raw
    );
    return { ...page, keywords: keywords(page.title, page.slug) };
  })
  .sort((a, b) => a.slug.localeCompare(b.slug));
