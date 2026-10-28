// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { dissolveBatches } from "~/modules/production/production.server";
import { serviceContext } from "~/modules/service-context.server";
import { startBackgroundBulkAction } from "~/utils/table-jobs.server";

// Bulk dissolve (`dissolveBatches`): one dissolve per selected Planned or
// Active batch. Each is independent: a batch that has recorded production is
// refused and reported in `failed` while the rest still dissolve; a
// Completing or Completed batch is skipped. `{ allMatching }` in
// place of `batchIds` dissolves every matching batch in the background job
// instead. Fetcher-driven; the table toasts the summary and the loader
// revalidates.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const auth = await requirePermissions(request, { update: "production" });

  const json = (await request.json().catch(() => null)) as {
    batchIds?: string[];
    allMatching?: unknown;
  } | null;
  const started = await startBackgroundBulkAction(
    request,
    "batches.dissolve",
    { allMatching: json?.allMatching },
    {}
  );
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

  const result = await dissolveBatches(serviceContext(auth), {
    batchIds: ids
  });
  if (result.error) return { success: false, message: result.error.message };
  return { success: true, ...result.data };
}
