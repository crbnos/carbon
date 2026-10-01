// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Ranked search over the docs corpus for the in-app agent's `search_docs`. Same
// engine as the tool catalog (catalog-search.ts): zbsearch BM25 with prefix
// expansion, SEARCH_ALIASES and word stems via expandQueryTerm, and a
// typo-tolerant second pass. It indexes SECTIONS, not pages, so a hit points the
// agent at the few hundred words it needs instead of a whole page.
import { create, insertMultiple, search } from "zbsearch";
import { expandQueryTerm } from "./catalog-search";

export type SearchableSection = {
  /** `null` for the text before a page's first heading. */
  heading: string | null;
  anchor: string | null;
  markdown: string;
};

export type SearchableDoc = {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  sections: SearchableSection[];
};

export type DocSearchHit<T extends SearchableDoc> = {
  doc: T;
  section: SearchableSection;
};

const DOC_SCHEMA = {
  id: "string",
  title: "string",
  heading: "string",
  keywords: "string",
  description: "string",
  body: "string"
} as const;

// The page's own fields ride on every section of it; the heading and body are the
// section's, so they decide which section of a matching page wins.
const DOC_BOOSTS = {
  title: 4,
  heading: 2,
  keywords: 2,
  description: 1.5,
  body: 1
};

// A long page has many matching sections; keep the results spread across pages.
const MAX_SECTIONS_PER_PAGE = 2;

// zbsearch ignores term frequency, so a short troubleshooting section whose heading
// repeats the query ties with the page's own overview. Weighting the intro (the text
// before the first heading) lets the page about the term lead, as on the docs site.
const INTRO_WEIGHT = 2;
const weighted = ([, score, doc]: [unknown, number, unknown]) =>
  (doc as { heading?: string }).heading === "" ? score * INTRO_WEIGHT : score;

async function buildDocIndex(docs: SearchableDoc[]) {
  const db = create({ schema: DOC_SCHEMA });
  await insertMultiple(
    db,
    docs.flatMap((doc) =>
      doc.sections.map((section, i) => ({
        id: `${doc.slug}#${i}`,
        title: doc.title,
        heading: section.heading ?? "",
        keywords: doc.keywords.join(" "),
        description: doc.description,
        body: section.markdown
      }))
    )
  );
  return db;
}

/** Returns a `(query, limit)` search over the docs' sections, best match first. */
export function createDocSearch<T extends SearchableDoc>(docs: T[]) {
  const byId = new Map(
    docs.flatMap((doc) =>
      doc.sections.map((section, i) => [`${doc.slug}#${i}`, { doc, section }])
    )
  );

  // Built lazily on the first query so importing this module stays free.
  let indexPromise: ReturnType<typeof buildDocIndex> | null = null;
  const getIndex = () => (indexPromise ??= buildDocIndex(docs));

  return async function searchDocs(
    query: string,
    limit: number
  ): Promise<DocSearchHit<T>[]> {
    const term = expandQueryTerm(query);
    if (!term) return [];

    const params = {
      term,
      properties: Object.keys(DOC_BOOSTS) as (keyof typeof DOC_BOOSTS)[],
      boost: DOC_BOOSTS,
      sortBy: (a: [unknown, number, unknown], b: [unknown, number, unknown]) =>
        weighted(b) - weighted(a),
      limit: limit * 12
    };
    const db = await getIndex();
    let results = await search(db, params);
    if (results.count === 0) {
      results = await search(db, { ...params, tolerance: 1 });
    }

    const perPage = new Map<string, number>();
    const hits: DocSearchHit<T>[] = [];
    for (const result of results.hits) {
      const hit = byId.get((result.document as { id: string }).id);
      if (!hit) continue;
      const count = perPage.get(hit.doc.slug) ?? 0;
      if (count >= MAX_SECTIONS_PER_PAGE) continue;
      perPage.set(hit.doc.slug, count + 1);
      hits.push(hit);
      if (hits.length === limit) break;
    }
    return hits;
  };
}
