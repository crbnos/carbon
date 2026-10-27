// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { integrations as availableIntegrations } from "@carbon/ee";
import {
  getSyncOperations,
  SyncOperationStatusSchema
} from "@carbon/ee/accounting";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { withSyncOperationReferences } from "~/modules/settings/settings.service";
import { SYNC_ACTIVITY_SORTS } from "~/modules/settings/ui/Integrations/SyncActivity";
import { decodeCursor, toPage } from "~/utils/cursor";
import { listErrorPage } from "~/utils/list-registry/list-error";
import { PAGE_SIZE } from "~/utils/pagination";

const logger = getLogger("erp", "integrations-sync-activity");

/**
 * GET — the Sync Activity rows after `?after=` (the previous page's last row),
 * under the tab's status filter (`?status=`). The Sync Activity tab loads
 * them as it scrolls (`useInfiniteRows` with this URL as its `pageUrl`), and
 * re-reads the loaded pages after a revalidation. Gated like the tab itself.
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

  const searchParams = new URL(request.url).searchParams;
  const status = SyncOperationStatusSchema.safeParse(
    searchParams.get("status")
  );
  const cursor = decodeCursor(searchParams.get("after"));
  const createdAt = cursor?.values[0];
  if (!cursor || typeof createdAt !== "string") {
    // A failed page, not a thrown response: the tab shows its own retry
    // row, where a thrown response would replace the page.
    logger.warn("Sync activity page cursor is not valid", { companyId });
    return listErrorPage("operations");
  }

  // One extra row tells whether a next page exists.
  const operations = await getSyncOperations(client, {
    companyId,
    integration: integration.id,
    status: status.success ? status.data : undefined,
    after: { createdAt, id: cursor.id },
    limit: PAGE_SIZE + 1
  });

  if (operations.error) {
    logger.error("Failed to load sync operations", {
      companyId,
      integration: integration.id,
      error: operations.error
    });
    return listErrorPage("operations");
  }

  const page = toPage(operations.data, {
    limit: PAGE_SIZE,
    sorts: SYNC_ACTIVITY_SORTS
  });

  return {
    operations: await withSyncOperationReferences(client, companyId, page.rows),
    nextCursor: page.nextCursor
  };
}
