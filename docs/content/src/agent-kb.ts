/// <reference types="vite/client" />
import {
  type CorpusPage,
  type CorpusSection,
  keywords,
  parsePage,
  splitSections
} from "./corpus";

// Vite-only: bundles every page's raw MDX into the importing build (the ERP server),
// so the agent needs no fs or docs app at runtime.
const sources = import.meta.glob(["../docs/**/*.mdx", "../guides/**/*.mdx"], {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;

export type AgentDoc = CorpusPage & {
  keywords: string[];
  /** The page split at its headings, so the agent can read one section at a time. */
  sections: CorpusSection[];
};

/** Every docs page as stripped markdown, sorted by slug (`docs/reference/jobs`). */
export const agentDocs: AgentDoc[] = Object.entries(sources)
  .map(([file, raw]) => {
    const page = parsePage(
      file.replace(/^\.\.\//, "").replace(/\.mdx$/, ""),
      raw
    );
    return {
      ...page,
      keywords: keywords(page.title, page.slug),
      sections: splitSections(page.markdown)
    };
  })
  .sort((a, b) => a.slug.localeCompare(b.slug));
