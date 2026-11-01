// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { chunkArray } from "@carbon/utils";
import {
  addBulkActionCounts,
  BULK_CHUNK_SIZE,
  collectRowIds,
  NO_BULK_COUNTS
} from "./bulk";
import type {
  TableBulkAction,
  TableBulkActionCarry,
  TableBulkActionResult,
  TableJobContext,
  TableJobHandlers
} from "./handlers";
import { readListPages } from "./paging";
import type { TableJobStorage } from "./storage";

/**
 * The step bodies of the background bulk action (`table-bulk-action.ts`).
 * Collect steps read the matching ids, up to 10,000 per step, and store each
 * step's ids as one file. Apply steps each read one slice of a file and run
 * the action on it, 100 ids per call. The function only orders the steps, so
 * these run, and are tested, without Inngest.
 */

const log = getLogger("jobs", "table-bulk-action");

export type CollectIdsResult = {
  /** Ids stored in this step's file. */
  ids: number;
  /** Rows this step read (counted against the run's row limit). */
  rows: number;
  nextCursor: string | null;
  truncated: boolean;
};

/**
 * Reads up to 10,000 rows from `cursor` and stores their ids at `key`, in
 * list order, without duplicates within the step. Reading first keeps the run
 * correct when the action changes a sort or filter column: a row the action
 * moved behind the cursor is never read again.
 */
export async function collectIds(
  deps: {
    handlers: Pick<TableJobHandlers, "fetchListPage" | "listIdColumn">;
    storage: Pick<TableJobStorage, "upload">;
  },
  args: {
    context: TableJobContext;
    listKey: string;
    search: string;
    cursor: string | null;
    rowsBefore: number;
    maxRows: number;
    key: string;
  }
): Promise<CollectIdsResult> {
  const idColumn = deps.handlers.listIdColumn(args.listKey);
  const ids = new Set<string>();
  const read = await readListPages({
    handlers: deps.handlers,
    listKey: args.listKey,
    context: args.context,
    search: args.search,
    cursor: args.cursor,
    rowsBefore: args.rowsBefore,
    maxRows: args.maxRows,
    onPage: (rows) => {
      collectRowIds(ids, rows, idColumn);
    }
  });
  await deps.storage.upload(
    args.key,
    JSON.stringify([...ids]),
    "application/json"
  );
  return {
    ids: ids.size,
    rows: read.rows,
    nextCursor: read.nextCursor,
    truncated: read.truncated
  };
}

/**
 * Stores the ids the user selected as the run's only id file, in place of the
 * collect steps: unique, non-empty, and at most `maxRows` of them.
 */
export async function storeSelectedIds(
  deps: { storage: Pick<TableJobStorage, "upload"> },
  args: { ids: string[]; maxRows: number; key: string }
): Promise<{ ids: number; truncated: boolean }> {
  const unique = [...new Set(args.ids.filter(Boolean))];
  const kept = unique.slice(0, args.maxRows);
  await deps.storage.upload(args.key, JSON.stringify(kept), "application/json");
  return { ids: kept.length, truncated: kept.length < unique.length };
}

/** The ids a collect step stored, or null when the file is not a list of
 *  strings. */
export function parseIdFile(bytes: Uint8Array): string[] | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Runs the action on ids `start` to `end` of the file at `key`, `chunkSize`
 * ids per call (at most 100). A chunk that throws counts as failed and the
 * rest still run; a file that cannot be read counts the whole slice as
 * failed. So the step never throws, and the run goes on to the next slice.
 * `carry` goes from chunk to chunk; the slice returns the last one, for the
 * next slice.
 */
export async function applyIdSlice(
  deps: {
    handlers: Pick<TableJobHandlers, "runBulkAction">;
    storage: Pick<TableJobStorage, "download">;
  },
  args: {
    context: TableJobContext;
    action: TableBulkAction;
    key: string;
    start: number;
    end: number;
    chunkSize: number;
    carry?: TableBulkActionCarry;
  }
): Promise<TableBulkActionResult> {
  const sliceSize = args.end - args.start;
  let ids: string[] | null = null;
  try {
    ids = parseIdFile(await deps.storage.download(args.key));
    if (!ids) {
      log.error("The ids file of a bulk action is not a list of ids", {
        companyId: args.context.companyId,
        key: args.key
      });
    }
  } catch (error) {
    log.error("Failed to read the ids of a bulk action", {
      companyId: args.context.companyId,
      key: args.key,
      error
    });
  }
  if (!ids)
    return withCarry({ done: 0, skipped: 0, failed: sliceSize }, args.carry);

  const size = Math.min(Math.max(1, args.chunkSize), BULK_CHUNK_SIZE);
  let counts = NO_BULK_COUNTS;
  let carry = args.carry;
  for (const chunk of chunkArray(ids.slice(args.start, args.end), size)) {
    try {
      const result = await deps.handlers.runBulkAction(
        args.action,
        chunk,
        args.context,
        carry
      );
      counts = addBulkActionCounts(counts, result);
      carry = result.carry ?? carry;
    } catch (error) {
      // One chunk's failure must not stop the rest: count it and go on.
      log.error("A chunk of the bulk action failed", {
        companyId: args.context.companyId,
        actionKey: args.action.key,
        error
      });
      counts = addBulkActionCounts(counts, {
        done: 0,
        skipped: 0,
        failed: chunk.length
      });
    }
  }
  return withCarry(counts, carry);
}

function withCarry(
  counts: TableBulkActionResult,
  carry: TableBulkActionCarry | undefined
): TableBulkActionResult {
  return carry === undefined ? counts : { ...counts, carry };
}
