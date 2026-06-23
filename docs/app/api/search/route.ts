import { createSearchAPI } from "fumadocs-core/search/server";
import { buildSearchIndexes } from "@/lib/search-index";

/* Single search endpoint across all four surfaces (Reference docs, the Guide, API
 * resources, MCP tools). Canonical fumadocs pattern: one combined `indexes` array, each
 * entry `tag`ged (docs | guide | resources | tools) so the header's surface pills can
 * filter via `?tag=`. Result count is capped client-side (no server limit in fumadocs). */

export const { GET } = createSearchAPI("advanced", {
  language: "english",
  indexes: buildSearchIndexes()
});
