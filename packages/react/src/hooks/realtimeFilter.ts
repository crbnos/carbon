// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Whether a change concerns the rows a PostgREST-style filter names. Only an
 * `id` filter can be answered from a broadcast, which carries ids and nothing
 * else: a filter on another column (`jobId=eq.…`) matches every change to the
 * table, and so does a change without ids.
 */
export function matchesIdFilter(
  filter: string | undefined,
  ids: string[] | null | undefined
): boolean {
  if (!filter || !ids) return true;
  const one = /^id=eq\.(.+)$/.exec(filter);
  if (one) return ids.includes(one[1] as string);
  const many = /^id=in\.\((.*)\)$/.exec(filter);
  if (many) {
    const wanted = new Set(
      (many[1] as string).split(",").map((id) => id.trim())
    );
    return ids.some((id) => wanted.has(id));
  }
  return true;
}
