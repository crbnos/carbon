// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Ranked full-text search over the tool catalog, extracted from server.ts so it
// is typed and unit-testable. Backed by zbsearch (BM25 + prefix expansion) with
// a curated alias layer in front — the engine knows nothing about ERP domain
// vocabulary, so "RMA" reaching the returns tools is our job, not its.
import type { Classification, ManifestEntry } from "@carbon/api";
import { stemInflection } from "@carbon/content/search";
import { create, insertMultiple, search } from "zbsearch";

/**
 * Domain synonyms expanded into the query before it hits the index. Keys are
 * single lowercase query tokens; values are the extra terms tried alongside
 * them. Additive only — the original token still participates, so an alias can
 * never hide an exact match. Keep entries defensible: each one maps an
 * industry-standard term to Carbon's own naming.
 */
export const SEARCH_ALIASES: Record<string, string[]> = {
  // documents & orders
  po: ["purchase", "order"],
  so: ["sales", "order"],
  wo: ["job", "work", "order"],
  rfq: ["quote"],
  quotation: ["quote"],
  quotations: ["quote"],
  grn: ["receipt"],
  receiving: ["receipt"],
  // quality & engineering
  ncr: ["nonconformance", "issue"],
  ncrs: ["nonconformance", "issue"],
  // Carbon names a non-conformance an issue (quality_getIssueItems, …).
  nonconformance: ["issue"],
  nonconformances: ["issues"],
  capa: ["issue", "action", "corrective"],
  eco: ["change", "order", "engineering"],
  ecn: ["change", "order"],
  coc: ["certificate"],
  rma: ["return"],
  // items & methods
  bom: ["method", "material"],
  boms: ["method", "material"],
  routing: ["method", "operation"],
  routings: ["method", "operation"],
  uom: ["unit", "of", "measure"],
  sku: ["item", "part"],
  // inventory ("shelf" was renamed to storage unit)
  shelf: ["storage", "unit"],
  shelves: ["storage", "unit"],
  bin: ["storage", "unit"],
  bins: ["storage", "unit"],
  // parties
  vendor: ["supplier"],
  vendors: ["suppliers"],
  // accounting
  ap: ["purchase", "invoice", "payable"],
  ar: ["sales", "invoice", "receivable"],
  gl: ["ledger", "account"],
  // planning
  mrp: ["planning", "requirement"],
  wip: ["production", "job"]
};

/**
 * Multi-word domain terms, matched against the whole query. Same rules as
 * SEARCH_ALIASES: additive, industry term → Carbon's naming.
 */
export const PHRASE_ALIASES: Record<string, string[]> = {
  "non conformance": ["issue"],
  "non conformances": ["issues"],
  "work order": ["job"],
  "work orders": ["jobs"],
  "bill of materials": ["method", "material"],
  "purchase requisition": ["purchase", "order"],
  "stock on hand": ["quantities"],
  "on hand": ["quantities"]
};

/**
 * Query words that name an action, mapped to the first word Carbon's tool names
 * use for it ("list customers" wants getCustomers, "add a part" wants
 * insertPart/upsertPart). Used only to re-rank by name.
 */
export const ACTION_SYNONYMS: Record<string, string[]> = {
  list: ["get"],
  find: ["get"],
  show: ["get"],
  fetch: ["get"],
  read: ["get"],
  lookup: ["get"],
  view: ["get"],
  count: ["get"],
  create: ["create", "insert", "upsert"],
  add: ["create", "insert", "upsert", "add"],
  new: ["create", "insert", "upsert"],
  edit: ["update", "upsert"],
  change: ["update", "upsert"],
  modify: ["update", "upsert"],
  update: ["update", "upsert"],
  remove: ["delete", "remove"]
};

/** Query words that carry no meaning for a tool name. */
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "for",
  "in",
  "on",
  "to",
  "by",
  "all",
  "my",
  "me",
  "how",
  "many",
  "much",
  "what",
  "which",
  "do",
  "we",
  "have",
  "is",
  "are"
]);

/** "getJobOperationsList" / "sales_getCustomers" → "get job operations list". */
export function splitWords(identifier: string): string {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

/** Every property key reachable in a JSON Schema, nested objects/arrays/unions included. */
export function collectFieldNames(
  schema: unknown,
  out = new Set<string>()
): Set<string> {
  if (!schema || typeof schema !== "object") return out;
  const node = schema as Record<string, unknown>;
  if (node.properties && typeof node.properties === "object") {
    for (const [key, value] of Object.entries(node.properties)) {
      out.add(key);
      collectFieldNames(value, out);
    }
  }
  if (node.items) collectFieldNames(node.items, out);
  for (const branch of ["anyOf", "oneOf", "allOf"]) {
    const variants = node[branch];
    if (Array.isArray(variants)) {
      for (const variant of variants) collectFieldNames(variant, out);
    }
  }
  return out;
}

/**
 * Build the search term: the query's words (camelCase split AND raw, so
 * "getCustomers" matches both the tokenized and the literal name) plus alias
 * expansions and word stems ("scrapping" adds "scrap"). BM25 scores documents
 * matching more of the terms higher, so the expansions never need to all hit.
 */
export function expandQueryTerm(query: string): string {
  const words = new Set<string>();
  for (const token of query.split(/[^a-zA-Z0-9]+/)) {
    if (!token) continue;
    words.add(token.toLowerCase());
    for (const word of splitWords(token).split(" ")) {
      if (word) words.add(word);
    }
  }
  for (const word of [...words]) {
    for (const alias of SEARCH_ALIASES[word] ?? []) {
      words.add(alias);
    }
  }
  const phrase = ` ${splitWords(query)} `;
  for (const [key, aliases] of Object.entries(PHRASE_ALIASES)) {
    if (phrase.includes(` ${key} `)) {
      for (const alias of aliases) words.add(alias);
    }
  }
  // Stems join the QUERY only, like aliases. Stemming the index collapsed "orders"
  // into "order", so list tools (getSalesOrders) lost their edge to single-record
  // ones (deleteSalesOrder).
  for (const word of [...words]) {
    words.add(stemInflection(word));
  }
  return [...words].join(" ");
}

/**
 * Order search hits by how well each tool's NAME answers the query. zbsearch
 * applies it as `sortBy` to every BM25 hit before paging. BM25 alone scores
 * repeated common words ("items", "get") over the one exact tool:
 * `inventory_getInventoryItems` ranked tenth for its own name, and no
 * `relevance` setting fixes that. Order, highest first:
 *
 * 1. the exact tool name, with or without its module ("getInventoryItems");
 * 2. query terms the name covers. A term is a query word, or a whole
 *    PHRASE_ALIASES phrase ("work orders"), which then stands in for its words;
 * 3. of those, terms matched in full: the word itself, an ACTION_SYNONYMS
 *    word ("create" → insert), every word of its alias ("po" → purchase order)
 *    or its phrase. A stem or part of an alias covers but is not full;
 * 4. with no action word in the query, READ tools first (a bare noun is a
 *    lookup);
 * 5. fewer name words the query did not ask for (getJob before
 *    getJobOperations for "job");
 * 6. a tool that pages in the database before a `get*List` that reads the
 *    whole table on every call ("list customers" wants getCustomers, not
 *    getCustomersList).
 *
 * Ties are left at 0 for the caller to break by BM25 score. Returns null when
 * the query has no words to rank by, so the BM25 order stands.
 *
 * `actions` is the set of first words of the catalog's function names (get,
 * insert, post, …), so a query counts as naming an action only when the
 * catalog has one.
 */
export function createNameComparator(
  query: string,
  actions: ReadonlySet<string>
): ((a: ManifestEntry, b: ManifestEntry) => number) | null {
  let words = [
    ...new Set(
      splitWords(query)
        .split(" ")
        .filter((word) => word && !STOPWORDS.has(word))
    )
  ];
  const phrases: string[][] = [];
  const text = ` ${splitWords(query)} `;
  for (const [key, aliases] of Object.entries(PHRASE_ALIASES)) {
    if (!text.includes(` ${key} `)) continue;
    const keyWords = key.split(" ");
    // Overlapping phrases ("stock on hand", "on hand") count once.
    if (!keyWords.some((word) => words.includes(word) || STOPWORDS.has(word))) {
      continue;
    }
    phrases.push(aliases);
    words = words.filter((word) => !keyWords.includes(word));
  }
  if (words.length === 0 && phrases.length === 0) return null;

  const needle = query.trim().toLowerCase();
  const hasAction = words.some(
    (word) => actions.has(word) || word in ACTION_SYNONYMS
  );

  const rank = (tool: ManifestEntry) => {
    const separator = tool.name.indexOf("_");
    const tokens = splitWords(tool.name).split(" ");
    const tokenSet = new Set(tokens);
    const used = new Set<string>();
    const use = (term: string) => {
      for (const token of tokens) {
        if (sameWord(token, term)) used.add(token);
      }
    };
    const hasStem = (term: string) =>
      tokens.some((token) => sameWord(token, term));

    let covered = 0;
    let full = 0;
    const matchAliases = (aliases: string[]) => {
      const present = aliases.filter(hasStem);
      if (present.length === 0) return false;
      covered++;
      if (present.length === aliases.length) full++;
      present.forEach(use);
      return true;
    };

    for (const word of words) {
      const action = (ACTION_SYNONYMS[word] ?? []).find((alt) =>
        tokenSet.has(alt)
      );
      if (tokenSet.has(word) || action) {
        covered++;
        full++;
        use(action ?? word);
      } else if (SEARCH_ALIASES[word] && matchAliases(SEARCH_ALIASES[word]!)) {
        // counted by matchAliases
      } else if (hasStem(word)) {
        covered++;
        use(word);
      }
    }
    for (const aliases of phrases) matchAliases(aliases);

    // The module prefix and a lookup's "get" are never extra.
    const moduleWords = new Set(
      splitWords(tool.name.slice(0, Math.max(separator, 0))).split(" ")
    );
    const name = tool.name.toLowerCase();
    return {
      exact: name === needle || name.slice(separator + 1) === needle ? 1 : 0,
      covered,
      full,
      readFirst: !hasAction && tool.classification === "READ" ? 1 : 0,
      extra: tokens.filter(
        (token) =>
          !used.has(token) && !moduleWords.has(token) && token !== "get"
      ).length,
      fullSet: !tool.paginates && tool.name.endsWith("List") ? 1 : 0
    };
  };

  // A sort compares each hit many times; rank each tool once.
  const ranks = new Map<string, ReturnType<typeof rank>>();
  const rankOf = (tool: ManifestEntry) => {
    let cached = ranks.get(tool.name);
    if (!cached) {
      cached = rank(tool);
      ranks.set(tool.name, cached);
    }
    return cached;
  };

  return (a, b) => {
    const x = rankOf(a);
    const y = rankOf(b);
    return (
      y.exact - x.exact ||
      y.covered - x.covered ||
      y.full - x.full ||
      y.readFirst - x.readFirst ||
      x.extra - y.extra ||
      x.fullSet - y.fullSet
    );
  };
}

/**
 * One word in two inflections. `stemInflection` alone misses plurals Porter
 * over-stems ("materials" stays "materials" because Porter makes it "materi"),
 * so a plain -s/-es plural also counts.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b || stemInflection(a) === stemInflection(b)) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long === `${short}s` || long === `${short}es`;
}

export type CatalogSearchOptions = {
  query?: string;
  module?: string;
  classification?: Classification;
  limit: number;
  offset: number;
};

export type CatalogSearchResult = {
  matches: ManifestEntry[];
  total: number;
};

export type CatalogSearch = {
  search: (options: CatalogSearchOptions) => Promise<CatalogSearchResult>;
  moduleNames: string[];
};

function fieldWords(tool: ManifestEntry): string {
  const words = new Set<string>();
  for (const field of collectFieldNames(tool.schema)) {
    for (const word of splitWords(field).split(" ")) {
      if (word) words.add(word);
    }
  }
  return [...words].join(" ");
}

const INDEX_SCHEMA = {
  name: "string",
  tokens: "string",
  description: "string",
  fields: "string",
  module: "enum",
  classification: "enum"
} as const;

async function buildIndex(tools: ManifestEntry[]) {
  const db = create({ schema: INDEX_SCHEMA });
  await insertMultiple(
    db,
    tools.map((tool) => ({
      name: tool.name,
      tokens: splitWords(tool.name),
      description: tool.description,
      fields: fieldWords(tool),
      module: tool.module,
      classification: tool.classification
    }))
  );
  return db;
}

export function createCatalogSearch(tools: ManifestEntry[]): CatalogSearch {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const actions = new Set(
    tools.map(
      (tool) =>
        splitWords(tool.name.slice(tool.name.indexOf("_") + 1)).split(" ")[0]!
    )
  );
  const moduleNames = [...new Set(tools.map((tool) => tool.module))].sort();

  // Built lazily on the first query so importing this module stays free.
  let indexPromise: ReturnType<typeof buildIndex> | null = null;
  const getIndex = () => (indexPromise ??= buildIndex(tools));

  async function searchCatalog(
    options: CatalogSearchOptions
  ): Promise<CatalogSearchResult> {
    const { query, module, classification, limit, offset } = options;

    // The module filter keeps its historic substring semantics ("sale" matches
    // "sales") by resolving to concrete module names for the enum filter.
    let modules: string[] | null = null;
    if (module) {
      const needle = module.toLowerCase();
      modules = moduleNames.filter((name) => name.includes(needle));
      if (modules.length === 0) return { matches: [], total: 0 };
    }

    const term = query ? expandQueryTerm(query) : "";

    if (!term) {
      const filtered = tools.filter(
        (tool) =>
          (!modules || modules.includes(tool.module)) &&
          (!classification || tool.classification === classification)
      );
      return {
        matches: filtered.slice(offset, offset + limit),
        total: filtered.length
      };
    }

    const where: Record<string, unknown> = {};
    if (modules) {
      where.module =
        modules.length === 1 ? { eq: modules[0] } : { in: modules };
    }
    if (classification) where.classification = { eq: classification };

    const compare = createNameComparator(query!, actions);
    const toolOf = (document: { name: string }) => byName.get(document.name)!;
    const params = {
      term,
      properties: ["name", "tokens", "description", "fields"] as (
        | "name"
        | "tokens"
        | "description"
        | "fields"
      )[],
      boost: { name: 4, tokens: 3, description: 1.5, fields: 0.5 },
      ...(Object.keys(where).length > 0 ? { where } : {}),
      ...(compare
        ? {
            sortBy: (
              [, scoreA, a]: [unknown, number, { name: string }],
              [, scoreB, b]: [unknown, number, { name: string }]
            ) => compare(toolOf(a), toolOf(b)) || scoreB - scoreA
          }
        : {}),
      limit,
      offset
    };

    const db = await getIndex();
    let results = await search(db, params);
    if (results.count === 0) {
      // Prefix expansion and typo tolerance are mutually exclusive in the
      // engine, so typos get a second pass rather than degrading every query.
      results = await search(db, { ...params, tolerance: 1 });
    }

    return {
      matches: results.hits.map((hit) =>
        toolOf(hit.document as { name: string })
      ),
      total: results.count
    };
  }

  return { search: searchCatalog, moduleNames };
}
