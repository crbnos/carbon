// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { integrations as availableIntegrations } from "@carbon/ee";
import {
  getSyncOperationsExportPage,
  type SyncOperationCursor,
  type SyncOperationExportRow,
  SyncOperationStatusSchema
} from "@carbon/ee/accounting";
import { CSV_CONTENT_TYPE, encodeCsv } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import { chunkArray } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import { getSyncOperationReadableIds } from "~/modules/settings/settings.server";
import {
  formatTrigger,
  getEntityLabel
} from "~/modules/settings/ui/Integrations/SyncActivity";

const logger = getLogger("erp", "integrations-sync-activity-csv");

/**
 * Rows read, resolved, encoded and written per step. Memory is bounded by one
 * page however long the integration's history is.
 */
const PAGE_SIZE = 1000;

/**
 * Operations per readable-id lookup: each batch becomes one `.in("id", …)`
 * per entity type, and a few hundred ids keeps that query string well under
 * PostgREST's URL limit.
 */
const READABLE_ID_BATCH_SIZE = 200;

const FIELDS = [
  "Created",
  "Status",
  "Entity",
  "Reference",
  "Entity ID",
  "Direction",
  "Trigger",
  "Attempts",
  "Last Attempt",
  "Completed",
  "External ID",
  "Error Code",
  "Error",
  "Operation ID"
];

/**
 * GET — the integration's Sync Activity as CSV. Every operation under the
 * tab's current status filter (`?status=`), not just the page on screen.
 * Gated like the tab itself, which lives on the settings-update drawer.
 *
 * Streamed one page at a time: the stream pulls the next page only when the
 * client has taken the last one, so a slow download pauses the reads instead
 * of buffering the history, and a cancelled download stops them.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const integration = availableIntegrations.find(
    (candidate) => candidate.id === params.id
  );
  if (!integration) {
    throw new Response("Integration not found", { status: 404 });
  }

  const status = SyncOperationStatusSchema.safeParse(
    new URL(request.url).searchParams.get("status")
  );

  const readPage = async (after?: SyncOperationCursor) => {
    const page = await getSyncOperationsExportPage(client, {
      companyId,
      integration: integration.id,
      status: status.success ? status.data : undefined,
      after,
      limit: PAGE_SIZE
    });
    if (page.error) {
      logger.error("Failed to load sync operations for export", {
        companyId,
        integration: integration.id,
        after,
        error: page.error
      });
    }
    return page;
  };

  // The first page is read before the response starts, so a failure here is
  // still a real 500 rather than a truncated 200.
  const firstPage = await readPage();
  if (firstPage.error) {
    throw new Response("Failed to export sync activity", { status: 500 });
  }

  const encoder = new TextEncoder();
  let pending: SyncOperationExportRow[] | null = firstPage.data;
  let isFirstPage = true;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pending === null) {
        controller.close();
        return;
      }

      const rows = pending;
      const csv = await encodePage(client, companyId, rows, isFirstPage);
      if (csv) {
        controller.enqueue(encoder.encode(isFirstPage ? csv : `\r\n${csv}`));
      }
      isFirstPage = false;

      const last = rows.at(-1);
      if (rows.length < PAGE_SIZE || !last) {
        pending = null;
        return;
      }

      // Headers are already sent: a failure past page one can only end the
      // download, which the browser reports as a failed file.
      const next = await readPage({ createdAt: last.createdAt, id: last.id });
      if (next.error) {
        controller.error(new Error("Failed to export sync activity"));
        return;
      }
      pending = next.data.length > 0 ? next.data : null;
    }
  });

  const suffix = status.success
    ? `-${status.data.toLowerCase().replace(/\s+/g, "-")}`
    : "";

  return new Response(body, {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${integration.id}-sync-activity${suffix}.csv"`
    }
  });
}

/** One page of operations → CSV text, resolving their document numbers. */
async function encodePage(
  client: SupabaseClient<Database>,
  companyId: string,
  operations: SyncOperationExportRow[],
  header: boolean
): Promise<string> {
  const readableIds: Awaited<ReturnType<typeof getSyncOperationReadableIds>> =
    {};
  for (const batch of chunkArray(operations, READABLE_ID_BATCH_SIZE)) {
    Object.assign(
      readableIds,
      await getSyncOperationReadableIds(client, companyId, batch)
    );
  }

  return encodeCsv(
    operations.map((operation) => ({
      Created: operation.createdAt,
      Status: operation.status,
      Entity: getEntityLabel(operation.entityType),
      Reference:
        readableIds[`${operation.entityType}:${operation.entityId}`]?.label ??
        operation.entityId,
      "Entity ID": operation.entityId,
      Direction: operation.direction === "push-to-accounting" ? "Push" : "Pull",
      Trigger: formatTrigger(operation.trigger),
      Attempts: operation.attemptCount,
      "Last Attempt": operation.lastAttemptAt,
      Completed: operation.completedAt,
      "External ID": operation.externalId,
      "Error Code": operation.errorCode,
      Error: operation.errorMessage,
      "Operation ID": operation.id
    })),
    { fields: FIELDS, header }
  );
}
