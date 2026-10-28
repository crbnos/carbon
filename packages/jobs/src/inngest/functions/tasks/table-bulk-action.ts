// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import {
  addBulkActionCounts,
  BULK_CHUNK_SIZE,
  bulkActionProblemsBody,
  bulkActionTitle,
  bulkActionTruncatedBody,
  DEFAULT_BULK_IDS_PER_STEP,
  MAX_BULK_ROWS,
  NO_BULK_COUNTS,
  planIdSlices
} from "../../../table-jobs/bulk";
import {
  applyIdSlice,
  collectIds,
  storeSelectedIds
} from "../../../table-jobs/bulk-run";
import { failTableJob } from "../../../table-jobs/failure";
import {
  requireTableJobHandlers,
  type TableBulkAction,
  type TableBulkActionCarry,
  type TableJobContext
} from "../../../table-jobs/handlers";
import {
  extendTableJobLock,
  releaseTableJobLock
} from "../../../table-jobs/lock";
import { notifyTableJobUser } from "../../../table-jobs/notify";
import {
  removeTableJobFolder,
  tableBulkIdsFolder,
  tableBulkIdsKey,
  tempStagingStorage
} from "../../../table-jobs/storage";
import { inngest } from "../../client";

const log = getLogger("jobs", "table-bulk-action");

function deps() {
  return {
    handlers: requireTableJobHandlers("Table bulk actions"),
    storage: tempStagingStorage()
  };
}

/** Deletes the id files of a run; the nightly cleanup is the backstop. */
async function removeIdFiles(companyId: string, bulkActionId: string) {
  try {
    await removeTableJobFolder(tableBulkIdsFolder(companyId, bulkActionId));
  } catch (error) {
    log.error("Failed to delete the id files of a bulk action", {
      companyId,
      bulkActionId,
      error
    });
  }
}

// TODO(scale): this job runs inside the ERP containers (api+/inngest.ts) and shares
// CPU with web requests. Move table export/bulk jobs to a dedicated worker service
// before large tenants run many 100k-row bulk actions at the same time.
export const tableBulkActionFunction = inngest.createFunction(
  {
    id: "table-bulk-action",
    // No retry: a second attempt of an apply step would run its chunks again,
    // and not every action is safe to repeat (Send Invite emails each user).
    // A failed chunk is counted as failed instead of failing the run.
    retries: 0,
    concurrency: { key: "event.data.companyId", limit: 1 },
    onFailure: ({ event, error }) => {
      const { companyId, userId, bulkActionId, actionKey, actionLabel } =
        event.data.event.data;
      return failTableJob({
        kind: "bulk",
        companyId,
        jobId: bulkActionId,
        folder: tableBulkIdsFolder(companyId, bulkActionId),
        notification: {
          event: NotificationEvent.TableBulkAction,
          companyId,
          userId,
          documentId: `failed:${bulkActionId}`,
          title: `${actionLabel} could not be completed`,
          body: "Some rows may have changed. Check the list, then try again.",
          dedupeId: `table-bulk-action:${bulkActionId}:failed`
        },
        error,
        context: { actionKey }
      });
    }
  },
  { event: "carbon/table-bulk-action" },
  async ({ event, step }) => {
    const {
      companyId,
      userId,
      bulkActionId,
      actionKey,
      actionLabel,
      params,
      listKey,
      search,
      ids: selectedIds
    } = event.data;
    const maxRows = event.data.maxRows ?? MAX_BULK_ROWS;
    const idsPerStep = event.data.idsPerStep ?? DEFAULT_BULK_IDS_PER_STEP;
    const context: TableJobContext = { companyId, userId };
    const action: TableBulkAction = { key: actionKey, params };

    // The route checked the permissions; read them again in case they changed
    // while the run waited in the company's queue.
    const allowed = await step.run("check-permission", () =>
      requireTableJobHandlers("Table bulk actions").canRunBulkAction(
        listKey,
        action,
        context
      )
    );

    if (!allowed) {
      await step.run("notify-denied", () =>
        notifyTableJobUser({
          event: NotificationEvent.TableBulkAction,
          companyId,
          userId,
          documentId: `failed:${bulkActionId}`,
          title: `${actionLabel} did not run`,
          body: "You no longer have permission to do this.",
          dedupeId: `table-bulk-action:${bulkActionId}:denied`
        })
      );
      await step.run("release-lock", () =>
        releaseTableJobLock("bulk", companyId, bulkActionId)
      );
      return { ran: false as const };
    }

    // 1. Read every matching id first, 10,000 rows per step, one file per
    //    step. A step returns counts only: the ids stay out of the run state.
    //    A run for selected rows stores those ids as its one file instead.
    const idsPerFile: number[] = [];
    let truncated = false;
    if (selectedIds) {
      const stored = await step.run("store-selected-ids", async () => {
        await extendTableJobLock("bulk", companyId, bulkActionId);
        return storeSelectedIds(deps(), {
          ids: selectedIds,
          maxRows,
          key: tableBulkIdsKey(companyId, bulkActionId, 0)
        });
      });
      idsPerFile.push(stored.ids);
      truncated = stored.truncated;
    } else {
      let cursor: string | null = null;
      let rows = 0;
      for (let file = 0; ; file++) {
        const key = tableBulkIdsKey(companyId, bulkActionId, file);
        const collected = await step.run(`collect-ids-${file}`, async () => {
          await extendTableJobLock("bulk", companyId, bulkActionId);
          return collectIds(deps(), {
            context,
            listKey,
            search,
            cursor,
            rowsBefore: rows,
            maxRows,
            key
          });
        });
        idsPerFile.push(collected.ids);
        rows += collected.rows;
        truncated = collected.truncated;
        cursor = collected.nextCursor;
        if (!cursor) break;
      }
    }

    // 2. Act on the ids, one step per slice of `idsPerStep`. The counts are
    //    summed here, outside the steps, from their stored results.
    let counts = NO_BULK_COUNTS;
    // What one slice hands the next (Jobs Release: the PO each supplier went
    // on). It comes from the stored step results, so a replay rebuilds it.
    let carry: TableBulkActionCarry | undefined;
    for (const slice of planIdSlices(idsPerFile, idsPerStep)) {
      const result = await step.run(
        `apply-${slice.file}-${slice.start}`,
        async () => {
          await extendTableJobLock("bulk", companyId, bulkActionId);
          return applyIdSlice(deps(), {
            context,
            action,
            key: tableBulkIdsKey(companyId, bulkActionId, slice.file),
            start: slice.start,
            end: slice.end,
            chunkSize: Math.min(idsPerStep, BULK_CHUNK_SIZE),
            carry
          });
        }
      );
      counts = addBulkActionCounts(counts, result);
      carry = (result.carry as TableBulkActionCarry | undefined) ?? carry;
    }

    await step.run("notify", () =>
      notifyTableJobUser({
        event: NotificationEvent.TableBulkAction,
        companyId,
        userId,
        documentId: bulkActionId,
        title: bulkActionTitle(actionLabel, counts),
        body:
          [
            truncated ? bulkActionTruncatedBody(maxRows) : undefined,
            bulkActionProblemsBody(counts)
          ]
            .filter(Boolean)
            .join("\n\n") || undefined,
        dedupeId: `table-bulk-action:${bulkActionId}:done`
      })
    );

    await step.run("remove-ids", () => removeIdFiles(companyId, bulkActionId));
    await step.run("release-lock", () =>
      releaseTableJobLock("bulk", companyId, bulkActionId)
    );
    return { ran: true as const, ...counts, truncated };
  }
);
