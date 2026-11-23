// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Fragment } from "react";

/**
 * Where `search` occurs in `text`, ignoring case: the `[start, end)` ranges a
 * list's ILIKE search (`searchFilter`) matched.
 */
export function searchMatches(
  text: string | null | undefined,
  search: string | null | undefined
): [number, number][] {
  const term = search?.trim();
  if (!text || !term) return [];
  const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return Array.from(text.matchAll(pattern), (match) => [
    match.index,
    match.index + match[0].length
  ]);
}

/** `text` with each of `ranges` (sorted, not overlapping) marked. */
export function Highlight({
  text,
  ranges
}: {
  text: string | null | undefined;
  ranges: [number, number][];
}) {
  if (!text) return null;
  if (ranges.length === 0) return <>{text}</>;

  const parts: JSX.Element[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) {
      parts.push(<Fragment key={cursor}>{text.slice(cursor, start)}</Fragment>);
    }
    parts.push(
      <mark
        key={start}
        className="bg-yellow-200 dark:bg-yellow-900/50 text-inherit rounded-sm"
      >
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  }
  if (cursor < text.length) {
    parts.push(<Fragment key={cursor}>{text.slice(cursor)}</Fragment>);
  }
  return <>{parts}</>;
}
