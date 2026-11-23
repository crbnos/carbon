// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { NotificationEvent } from "@carbon/notifications";
import {
  composeExport,
  type ExportDeps,
  removeExportParts,
  writeExportPart
} from "../../../table-jobs/export-run";
import { failTableJob } from "../../../table-jobs/failure";
import {
  requireTableJobHandlers,
  type TableJobContext
} from "../../../table-jobs/handlers";
import {
  extendTableJobLock,
  releaseTableJobLock
} from "../../../table-jobs/lock";
import { notifyTableJobUser } from "../../../table-jobs/notify";
import {
  tableExportPartKey,
  tableExportPartsFolder,
  tableExportStorageKey,
  tempStagingStorage
} from "../../../table-jobs/storage";
import { inngest } from "../../client";

const rowCount = new Intl.NumberFormat("en-US");

function deps(): ExportDeps {
  return {
    handlers: requireTableJobHandlers("Table export"),
    storage: tempStagingStorage()
  };
}

// TODO(scale): this job runs inside the ERP containers (api+/inngest.ts) and shares
// CPU with web requests. Move table export/bulk jobs to a dedicated worker service
// before large tenants run many 100k-row exports at the same time.
export const tableExportFunction = inngest.createFunction(
  {
    id: "table-export",
    // Every step is safe to repeat: a part is written again under the same
    // key, and the notification carries an event id Inngest de-duplicates.
    retries: 1,
    concurrency: { key: "event.data.companyId", limit: 1 },
    onFailure: ({ event, error }) => {
      const { companyId, userId, exportId, listKey } = event.data.event.data;
      return failTableJob({
        kind: "export",
        companyId,
        jobId: exportId,
        folder: tableExportPartsFolder(companyId, userId, exportId),
        notification: {
          event: NotificationEvent.TableExport,
          companyId,
          userId,
          documentId: `failed:${exportId}`,
          title: "Your export could not be completed",
          body: "Try again. If it fails again, filter the list to fewer rows.",
          inAppOnly: true,
          dedupeId: `table-export:${exportId}:failed`
        },
        error,
        context: { listKey }
      });
    }
  },
  { event: "carbon/table-export" },
  async ({ event, step }) => {
    const { companyId, userId, exportId, listKey, search, columns } =
      event.data;
    const context: TableJobContext = { companyId, userId };

    // The route checked the permission; read it again in case it changed
    // while the run waited in the company's queue.
    const allowed = await step.run("check-permission", () =>
      requireTableJobHandlers("Table export").canReadList(listKey, context)
    );

    if (!allowed) {
      await step.run("notify-denied", () =>
        notifyTableJobUser({
          event: NotificationEvent.TableExport,
          companyId,
          userId,
          documentId: `failed:${exportId}`,
          title: "Your export did not run",
          body: "You no longer have access to this list.",
          inAppOnly: true,
          dedupeId: `table-export:${exportId}:denied`
        })
      );
      await step.run("release-lock", () =>
        releaseTableJobLock("export", companyId, exportId)
      );
      return { exported: false as const };
    }

    // One step per 10,000 rows: a step is one HTTP request, and the load
    // balancer cuts a request at 600 s.
    const partKeys: string[] = [];
    let cursor: string | null = null;
    let rows = 0;
    let bytes = 0;
    let truncated = false;
    for (let part = 0; ; part++) {
      const key = tableExportPartKey(companyId, userId, exportId, part);
      const result = await step.run(`write-part-${part}`, async () => {
        await extendTableJobLock("export", companyId, exportId);
        return writeExportPart(deps(), {
          context,
          listKey,
          search,
          columns,
          cursor,
          part,
          rowsBefore: rows,
          bytesBefore: bytes,
          key
        });
      });
      partKeys.push(key);
      rows += result.rows;
      bytes += result.bytes;
      truncated = result.truncated;
      cursor = result.nextCursor;
      if (!cursor) break;
    }

    const exportKey = tableExportStorageKey(companyId, userId, exportId);
    await step.run("compose", () =>
      composeExport(deps(), { partKeys, key: exportKey })
    );
    // Its own step: a compose retried after the parts were gone would fail.
    await step.run("remove-parts", () =>
      removeExportParts(deps(), { partKeys, key: exportKey })
    );

    await step.run("notify", () =>
      notifyTableJobUser({
        event: NotificationEvent.TableExport,
        companyId,
        userId,
        documentId: exportId,
        title: truncated
          ? `Your export is ready (first ${rowCount.format(rows)} rows)`
          : "Your export is ready",
        body: truncated
          ? `The list has more than ${rowCount.format(rows)} rows. Filter it to export the rest.`
          : `${rowCount.format(rows)} ${rows === 1 ? "row" : "rows"}`,
        dedupeId: `table-export:${exportId}:ready`
      })
    );

    await step.run("release-lock", () =>
      releaseTableJobLock("export", companyId, exportId)
    );
    return { exported: true as const, rows, truncated };
  }
);
