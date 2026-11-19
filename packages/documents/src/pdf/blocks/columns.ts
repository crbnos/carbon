// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The width of each table column once the user's hidden columns are gone. A
 * hidden column's width goes to `grow` (the description column), so the table
 * still fills the page. A hidden column gets no width and is not rendered.
 */
export function columnWidths<K extends string>(
  columns: readonly { key: K; width: number }[],
  shows: (key: K) => boolean,
  grow: K
): Partial<Record<K, string>> {
  const visible = columns.filter((column) => shows(column.key));
  const freed = columns
    .filter((column) => !shows(column.key))
    .reduce((sum, column) => sum + column.width, 0);
  const target = visible.some((column) => column.key === grow)
    ? grow
    : visible[0]?.key;

  const widths: Partial<Record<K, string>> = {};
  for (const column of visible) {
    const width = column.width + (column.key === target ? freed : 0);
    widths[column.key] = `${width}%`;
  }
  return widths;
}
