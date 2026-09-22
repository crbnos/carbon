// Ranked full-text search over the tool catalog, extracted from server.ts so it
// is typed and unit-testable. Backed by zbsearch (BM25 + prefix expansion) with
// a curated alias layer in front — the engine knows nothing about ERP domain
// vocabulary, so "RMA" reaching the returns tools is our job, not its.
import type { Classification, ManifestEntry } from "@carbon/api";
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
  vendors: ["supplier"],
  // accounting
  ap: ["purchase", "invoice", "payable"],
  ar: ["sales", "invoice", "receivable"],
  gl: ["ledger", "account"],
  // planning
  mrp: ["planning", "requirement"],
  wip: ["production", "job"]
};

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
 * expansions. BM25 scores documents matching more of the terms higher, so the
 * expansions never need to all hit.
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
  return [...words].join(" ");
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
      matches: results.hits
        .map((hit) => byName.get((hit.document as { name: string }).name))
        .filter((tool): tool is ManifestEntry => tool !== undefined),
      total: results.count
    };
  }

  return { search: searchCatalog, moduleNames };
}
