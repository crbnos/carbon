// Ranked search over the docs corpus for the in-app agent's `search_docs`. Same
// engine as the tool catalog (catalog-search.ts): zbsearch BM25 with prefix
// expansion, SEARCH_ALIASES and word stems via expandQueryTerm, and a
// typo-tolerant second pass — indexed over doc fields instead of tool fields.
import { create, insertMultiple, search } from "zbsearch";
import { expandQueryTerm } from "./catalog-search";

export type SearchableDoc = {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  headings: string[];
  markdown: string;
};

const DOC_SCHEMA = {
  slug: "string",
  title: "string",
  keywords: "string",
  headings: "string",
  description: "string",
  body: "string"
} as const;

const DOC_BOOSTS = {
  title: 4,
  keywords: 3,
  headings: 2,
  description: 1.5,
  body: 1
};

async function buildDocIndex(docs: SearchableDoc[]) {
  const db = create({ schema: DOC_SCHEMA });
  await insertMultiple(
    db,
    docs.map((doc) => ({
      slug: doc.slug,
      title: doc.title,
      keywords: doc.keywords.join(" "),
      headings: doc.headings.join(" "),
      description: doc.description,
      body: doc.markdown
    }))
  );
  return db;
}

/** Returns a `(query, limit)` search over `docs`, best match first. */
export function createDocSearch<T extends SearchableDoc>(docs: T[]) {
  const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));

  // Built lazily on the first query so importing this module stays free.
  let indexPromise: ReturnType<typeof buildDocIndex> | null = null;
  const getIndex = () => (indexPromise ??= buildDocIndex(docs));

  return async function searchDocs(query: string, limit: number): Promise<T[]> {
    const term = expandQueryTerm(query);
    if (!term) return [];

    const params = {
      term,
      properties: Object.keys(DOC_BOOSTS) as (keyof typeof DOC_BOOSTS)[],
      boost: DOC_BOOSTS,
      limit
    };
    const db = await getIndex();
    let results = await search(db, params);
    if (results.count === 0) {
      results = await search(db, { ...params, tolerance: 1 });
    }

    return results.hits
      .map((hit) => bySlug.get((hit.document as { slug: string }).slug))
      .filter((doc): doc is T => doc !== undefined);
  };
}
