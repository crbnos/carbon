// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { chunkArray } from "@carbon/utils";

const logger = getLogger("erp", "bulk-delete");

/** An `.in()` filter rides in the request URL, so ids go 100 at a time. */
const IN_CHUNK = 100;

export type BulkDeleteResult = {
  /** Rows the database deleted. */
  deleted: number;
  /** Ids it did not delete: another status, another company, or not found. */
  skipped: number;
  /** Ids whose delete failed (a whole chunk fails together). */
  failed: number;
  /** The first failure's message, or null. */
  error: string | null;
};

type DeleteChunk = (ids: string[]) => PromiseLike<{
  data: { id: string }[] | null;
  error: { message: string } | null;
}>;

/**
 * A table's bulk Delete: deletes the ids 100 at a time and counts the rows
 * that went. `deleteChunk` filters on the company AND the statuses the action
 * accepts in the DELETE itself and returns the deleted ids (`.select("id")`),
 * so a row whose status changed since the user selected it stays, and the
 * counts are the database's, not the request's.
 */
export async function bulkDeleteByStatus(args: {
  ids: string[];
  companyId: string;
  /** What is deleted, for the log ("jobs"). */
  label: string;
  deleteChunk: DeleteChunk;
}): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = {
    deleted: 0,
    skipped: 0,
    failed: 0,
    error: null
  };
  const ids = [...new Set(args.ids.filter(Boolean))];
  for (const chunk of chunkArray(ids, IN_CHUNK)) {
    const deleted = await args.deleteChunk(chunk);
    if (deleted.error) {
      logger.error("Failed to delete {label}", {
        label: args.label,
        companyId: args.companyId,
        error: deleted.error
      });
      result.failed += chunk.length;
      result.error ??= deleted.error.message;
      continue;
    }
    const count = deleted.data?.length ?? 0;
    result.deleted += count;
    result.skipped += chunk.length - count;
  }
  return result;
}
