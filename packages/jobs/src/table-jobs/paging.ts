// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TableJobContext, TableJobHandlers } from "./handlers";

/** Rows per page the table jobs read. Below PostgREST's `max_rows` (1,000):
 *  the list query asks for one row more than this to know if a page follows. */
export const TABLE_JOB_PAGE_SIZE = 500;

/**
 * Pages one Inngest step reads (10,000 rows). A step is one HTTP request, and
 * the load balancer cuts a request at 600 s; 20 list queries stay well below
 * that even on a slow view. Past this the job goes on in a new step from the
 * cursor the last one returned.
 */
export const TABLE_JOB_PAGES_PER_STEP = 20;

/** Rows one step reads at most. */
export const TABLE_JOB_ROWS_PER_STEP =
  TABLE_JOB_PAGE_SIZE * TABLE_JOB_PAGES_PER_STEP;

export type ListPagesResult = {
  /** Rows this call read. */
  rows: number;
  /** Where the next step starts, or null when there is nothing more to read. */
  nextCursor: string | null;
  /** True when the read stopped at `maxRows` (or `onPage` stopped it) while
   *  the list had more rows. */
  truncated: boolean;
};

/**
 * Reads up to `TABLE_JOB_PAGES_PER_STEP` pages of a list from `cursor` and
 * hands each to `onPage`. Stops at the end of the list, at `maxRows` rows in
 * total (`rowsBefore` were read by earlier steps), or when `onPage` answers
 * false. Throws when a page cannot be read.
 */
export async function readListPages(args: {
  handlers: Pick<TableJobHandlers, "fetchListPage">;
  listKey: string;
  context: TableJobContext;
  search: string;
  cursor: string | null;
  rowsBefore: number;
  maxRows: number;
  /** Read the rows as the CSV export writes them (`fetchListPage`). */
  forExport?: boolean;
  onPage: (rows: Record<string, unknown>[]) => boolean | void;
}): Promise<ListPagesResult> {
  let cursor = args.cursor;
  let rows = 0;
  for (let page = 0; page < TABLE_JOB_PAGES_PER_STEP; page++) {
    const remaining = args.maxRows - args.rowsBefore - rows;
    if (remaining <= 0) return { rows, nextCursor: null, truncated: true };

    const result = await args.handlers.fetchListPage(
      args.listKey,
      args.context,
      args.search,
      {
        cursor,
        limit: Math.min(TABLE_JOB_PAGE_SIZE, remaining),
        ...(args.forExport ? { forExport: true } : {})
      }
    );
    if (result.error) {
      throw new Error(`Failed to read the list "${args.listKey}"`, {
        cause: result.error
      });
    }
    rows += result.rows.length;
    const keepGoing = args.onPage(result.rows) !== false;
    cursor = result.nextCursor;
    if (!cursor) return { rows, nextCursor: null, truncated: false };
    if (!keepGoing || args.rowsBefore + rows >= args.maxRows) {
      return { rows, nextCursor: null, truncated: true };
    }
  }
  return { rows, nextCursor: cursor, truncated: false };
}
