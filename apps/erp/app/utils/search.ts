// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

const NOT_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

/**
 * The words of a list search, normalized as the `searchText` computed field
 * stores its values: lower-cased, with everything but letters and digits
 * removed. A packing slip prints BRK-514 where Carbon holds BRK514, and both
 * read brk514. Every word must match.
 *
 * JavaScript's `\p{L}\p{N}` and Postgres's `[[:alnum:]]` can disagree on a
 * non-ASCII letter, depending on the database locale.
 */
export function searchTerms(search: string | null | undefined): string[] {
  if (!search) return [];
  return search
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(NOT_ALPHANUMERIC, ""))
    .filter(Boolean);
}

/**
 * Where the search terms occur in `text`, matched the way the search matches
 * (case, spaces and punctuation ignored): sorted, merged `[start, end)` ranges
 * of `text`, so a highlight covers BRK-514 for the term brk514.
 */
export function searchMatches(
  text: string,
  terms: string[]
): [number, number][] {
  if (!text || terms.length === 0) return [];

  // The normalized text, and for each of its characters the index in `text`
  // it came from.
  let normalized = "";
  const source: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const lower = text[i]!.toLowerCase().replace(NOT_ALPHANUMERIC, "");
    for (const char of lower) {
      normalized += char;
      source.push(i);
    }
  }

  const ranges: [number, number][] = [];
  for (const term of terms) {
    let from = normalized.indexOf(term);
    while (from !== -1) {
      const end = from + term.length;
      ranges.push([source[from]!, source[end - 1]! + 1]);
      from = normalized.indexOf(term, end);
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
}

/** One line of a document, as the `searchLines` computed field returns it. */
export type SearchLine = {
  id: string;
  itemReadableId: string | null;
  itemName: string | null;
  description: string | null;
  partNumber: string | null;
  /** The order an invoice line bills; absent on other documents. */
  orderNumber?: string | null;
  /** One quantity, or one per price break on a quote or an RFQ line. */
  quantity: number | number[] | null;
  unitOfMeasureCode: string | null;
};

/**
 * Adds `searchLines` for the table on screen only (`forScreen`). The cast
 * keeps the list's literal select type; the table reads the lines through
 * `searchLinesOf`.
 */
export function withSearchLines<Columns extends string>(
  columns: Columns,
  forScreen: boolean | undefined
): Columns {
  return (forScreen ? `${columns},searchLines` : columns) as Columns;
}

export function searchLinesOf(row: object): SearchLine[] {
  const lines = (row as { searchLines?: unknown }).searchLines;
  return Array.isArray(lines) ? (lines as SearchLine[]) : [];
}

/**
 * The lines of a list row that a search word matched, in line order. A row
 * searched only by a header value has none.
 */
export function matchingSearchLines(
  row: object,
  terms: string[]
): SearchLine[] {
  if (terms.length === 0) return [];
  // The values SQL `search_lines_text` puts in `searchText`, so every row a
  // line value matched has a line to show.
  return searchLinesOf(row).filter((line) =>
    [
      line.itemReadableId,
      line.itemName,
      line.description,
      line.partNumber,
      line.orderNumber
    ].some((value) => !!value && searchMatches(value, terms).length > 0)
  );
}
