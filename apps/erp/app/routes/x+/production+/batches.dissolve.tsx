// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getErrorMessage } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { updateJobOperationBatch } from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";

// Bulk dissolve — one server-fn dissolve per selected batch. Each is independent:
// a batch that has recorded production is refused (the server fn's own guard) and
// reported in `failed` while the rest still dissolve. Fetcher-driven; the table
// toasts the summary and the loader revalidates.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { batchIds } = (await request.json()) as { batchIds?: string[] };
  const ids = [...new Set((batchIds ?? []).filter(Boolean))];
  if (ids.length === 0) {
    return { success: false, message: "No batches selected" };
  }

  // Resolve readable ids up front so failures name the batch, not its nanoid.
  const rows = await client
    .from("jobOperationBatch")
    .select("id, readableId")
    .in("id", ids)
    .eq("companyId", companyId);
  const readableById = new Map(
    (rows.data ?? []).map((r) => [r.id, r.readableId] as const)
  );

  let dissolved = 0;
  const failed: { readableId: string; message: string }[] = [];
  for (const batchId of ids) {
    const result = await updateJobOperationBatch(client, getDatabaseClient(), {
      type: "dissolve",
      batchId,
      companyId,
      userId
    });
    if (result.error) {
      failed.push({
        readableId: readableById.get(batchId) ?? batchId,
        message: getErrorMessage(result.error, "Failed to dissolve")
      });
    } else {
      dissolved += 1;
    }
  }

  return { success: true, dissolved, failed };
}
