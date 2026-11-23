// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TableBulkActionCounts } from "./handlers";

/**
 * Pure parts of the background bulk action: how the job reads ids, sums the
 * counts and words the notification.
 */

/** Ids per `runBulkAction` call: an `.in()` filter rides in the request URL. */
export const BULK_CHUNK_SIZE = 100;

/** The most rows one run acts on, unless the action sets a lower limit
 *  (`maxRows` on the event). The run acts on the first rows above it. */
export const MAX_BULK_ROWS = 100_000;

/** Ids one apply step acts on, unless the action sets fewer (`idsPerStep` on
 *  the event): an action that does more per row gets smaller steps, so one
 *  step stays well below the load balancer's 600 s. */
export const DEFAULT_BULK_IDS_PER_STEP = 1_000;

export const NO_BULK_COUNTS: TableBulkActionCounts = {
  done: 0,
  skipped: 0,
  failed: 0
};

/** Problem lines a run keeps for its notification. They ride in the step
 *  results, so the list stays short; the rest are only counted. */
export const MAX_BULK_PROBLEMS = 20;

export function addBulkActionCounts(
  a: TableBulkActionCounts,
  b: TableBulkActionCounts
): TableBulkActionCounts {
  const counts = {
    done: a.done + b.done,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed
  };
  const problemCount = countProblems(a) + countProblems(b);
  if (problemCount === 0) return counts;
  return {
    ...counts,
    problems: [...(a.problems ?? []), ...(b.problems ?? [])].slice(
      0,
      MAX_BULK_PROBLEMS
    ),
    problemCount
  };
}

function countProblems(counts: TableBulkActionCounts): number {
  return counts.problemCount ?? counts.problems?.length ?? 0;
}

/**
 * Adds the string ids of a page to `ids`, in page order. A row without an id
 * is left out. The Set drops a row that an earlier page already held.
 */
export function collectRowIds(
  ids: Set<string>,
  rows: Record<string, unknown>[],
  idColumn: string
): void {
  for (const row of rows) {
    const id = row[idColumn];
    if (typeof id === "string" && id.length > 0) ids.add(id);
    else if (typeof id === "number") ids.add(String(id));
  }
}

const count = new Intl.NumberFormat("en-US");

/** The notification title: the action, then the counts. The topbar shows
 *  the title only, so the counts must be in it. */
export function bulkActionTitle(
  actionLabel: string,
  counts: TableBulkActionCounts
): string {
  return `${actionLabel} finished: ${count.format(counts.done)} done, ${count.format(
    counts.skipped
  )} skipped, ${count.format(counts.failed)} failed`;
}

/** The notification body's lines for the rows that failed or need a fix. */
export function bulkActionProblemsBody(
  counts: TableBulkActionCounts
): string | undefined {
  const problems = counts.problems ?? [];
  if (problems.length === 0) return undefined;
  const more = countProblems(counts) - problems.length;
  return more > 0
    ? [...problems, `and ${count.format(more)} more`].join("\n")
    : problems.join("\n");
}

/** The notification body when the run stopped at its row limit. */
export function bulkActionTruncatedBody(maxRows: number): string {
  return `The list has more than ${count.format(maxRows)} rows. Only the first ${count.format(
    maxRows
  )} were processed. Filter the list to process the rest.`;
}

export type IdSlice = { file: number; start: number; end: number };

/**
 * Splits the collected ids into the slices the apply steps act on: each
 * collect step wrote one file of `idsPerFile[file]` ids, and each slice is at
 * most `idsPerStep` ids of one file. An empty file has no slice.
 */
export function planIdSlices(
  idsPerFile: number[],
  idsPerStep: number
): IdSlice[] {
  const size = Math.max(1, idsPerStep);
  const slices: IdSlice[] = [];
  idsPerFile.forEach((total, file) => {
    for (let start = 0; start < total; start += size) {
      slices.push({ file, start, end: Math.min(start + size, total) });
    }
  });
  return slices;
}
