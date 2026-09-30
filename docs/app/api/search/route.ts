import { stemInflection } from "@carbon/content/search";
import { createSearchAPI } from "fumadocs-core/search/server";
import { buildSearchIndexes } from "@/lib/search-index";

/* Single search endpoint across all four surfaces (Reference docs, the Guide, API
 * resources, MCP tools). Canonical fumadocs pattern: one combined `indexes` array, each
 * entry `tag`ged (docs | guide | resources | tools) so the header's surface pills can
 * filter via `?tag=`. */

// zbsearch ignores term frequency, so a one-word fragment ("Shipment" in the audit
// log's entity table) scores the same as a page titled "Shipments", and the tie falls
// to insertion order. Weighting each page's own title row puts the page about the
// term ahead of pages that only mention it; groups follow this order.
const TITLE_WEIGHT = 2;
const weighted = ([, score, doc]: [unknown, number, unknown]) =>
  (doc as { type?: string }).type === "page" ? score * TITLE_WEIGHT : score;

const { GET: search } = createSearchAPI("advanced", {
  language: "english",
  // Inflection-only stemming ("purchase order" matches "Purchase orders"), the same
  // stemInflection MCP search_tools and the agent's search_docs add to their queries.
  tokenizer: { language: "english", stemming: true, stemmer: stemInflection },
  search: { sortBy: (a, b) => weighted(b) - weighted(a) },
  indexes: buildSearchIndexes()
});

/**
 * Fumadocs has no server-side result limit, and with 1,495 operations indexed a
 * common prefix is pathological: "get" matches every READ operation and returned a
 * 544 KB body — per keystroke — of which the palette displays eight pages.
 *
 * Results arrive relevance-ordered, so truncating keeps the best matches. The cap is
 * well above what the client can show (MAX_PAGES x MAX_ROWS_PER_PAGE in
 * `search-command.tsx`) so grouping still has spare rows to work with; it exists to
 * stop the tail, not to do the client's job.
 */
const MAX_RESULTS = 80;

export async function GET(request: Request): Promise<Response> {
  const response = await search(request as Parameters<typeof search>[0]);
  if (!response.ok) return response;

  const results = await response.json();
  if (!Array.isArray(results) || results.length <= MAX_RESULTS) {
    return Response.json(results);
  }
  return Response.json(results.slice(0, MAX_RESULTS));
}
