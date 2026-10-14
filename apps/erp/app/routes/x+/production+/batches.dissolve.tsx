// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { bulkDissolveBatches } from "~/modules/production/bulk-actions.server";
import { getDatabaseClient } from "~/services/database.server";
import { startAllMatchingBulkAction } from "~/utils/table-jobs.server";

// Bulk dissolve — one server-fn dissolve per selected Planned or Active batch.
// Each is independent: a batch that has recorded production is refused (the
// server fn's own guard) and reported in `failed` while the rest still
// dissolve; a Completing or Completed batch is skipped. `{ allMatching }` in
// place of `batchIds` dissolves every matching batch in the background job
// instead. Fetcher-driven; the table toasts the summary and the loader
// revalidates.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const json = (await request.json().catch(() => null)) as {
    batchIds?: string[];
    allMatching?: unknown;
  } | null;
  const started = await startAllMatchingBulkAction(json?.allMatching, {
    companyId,
    userId,
    actionKey: "batches.dissolve",
    params: {}
  });
  if (started) return started;

  const ids = [
    ...new Set(
      (Array.isArray(json?.batchIds) ? json.batchIds : []).filter(
        (id): id is string => typeof id === "string" && id.length > 0
      )
    )
  ];
  if (ids.length === 0) {
    return { success: false, message: "No batches selected" };
  }

  const result = await bulkDissolveBatches({
    client,
    db: getDatabaseClient(),
    batchIds: ids,
    companyId,
    userId
  });
  if (!result.success) return result;
  return {
    success: true,
    dissolved: result.done,
    failed: result.failed,
    skipped: result.skipped
  };
}
