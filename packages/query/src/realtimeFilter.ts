// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** What a broadcast says about the rows that changed. */
type Changed = {
  ids?: string[] | null;
  /** The values of each `<name>Id` column of the changed rows. */
  parents?: Record<string, string[]> | null;
};

/**
 * Whether a change concerns the rows a PostgREST-style filter names:
 * `id=eq.<id>`, `id=in.(<ids>)`, or the same on a `<name>Id` column
 * (`jobId=eq.<id>`). A broadcast carries ids and nothing else, so a filter on
 * any other column matches every change. So does a change that does not say:
 * a bulk change carries neither ids nor parents, and a column with many values
 * is left out. The answer errs towards "it may concern me".
 */
export function matchesFilter(
  filter: string | undefined,
  change: Changed
): boolean {
  const parsed = filter && /^(\w+)=(eq|in)\.(.*)$/.exec(filter);
  if (!parsed) return true;
  const [, column, operator, value] = parsed as unknown as [
    string,
    string,
    string,
    string
  ];
  const changed = column === "id" ? change.ids : change.parents?.[column];
  if (!changed) return true;
  const wanted =
    operator === "eq"
      ? [value]
      : value
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((id) => id.trim());
  return wanted.some((id) => changed.includes(id));
}
