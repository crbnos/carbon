import { createSearchAPI } from "fumadocs-core/search/server";
import { buildSearchIndexes } from "@/lib/search-index";

/* Single search endpoint across all four surfaces (Reference docs, the Guide, API
 * resources, MCP tools). Canonical fumadocs pattern: one combined `indexes` array, each
 * entry `tag`ged (docs | guide | resources | tools) so the header's surface pills can
 * filter via `?tag=`. */

const { GET: search } = createSearchAPI("advanced", {
  language: "english",
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
