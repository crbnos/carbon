// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { bulkReleaseBatches } from "~/modules/production/bulk-actions.server";
import { getDatabaseClient } from "~/services/database.server";
import { fitsOneRequest } from "~/utils/table-jobs";
import {
  startAllMatchingBulkAction,
  startSelectedBulkAction
} from "~/utils/table-jobs.server";

// Bulk release — one release per selected Planned batch. Each is independent:
// a batch the server fn refuses (no members, already recorded production) is
// reported in `failed` while the rest still release. Only Planned batches are
// released — the caller filters, and bulkReleaseBatches skips any other status
// too, so a stale selection can't flip an Active/Completing batch.
// `{ allMatching: { listKey, search } }` in place of `batchIds` releases every
// matching batch in the background job instead, up to 2,000 batches. More
// than 10 selected batches also go to the background job: each releases its
// member jobs with MRP, and one request must end before the 600 s cutoff.
// Fetcher-driven; the table toasts the summary and the loader revalidates.
const bodySchema = z.object({ batchIds: z.array(z.string()) });

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  // A body that is not JSON, or not the shape the table sends, is a plain
  // refusal rather than a 500.
  const json = await request.json().catch(() => null);
  const started = await startAllMatchingBulkAction(json?.allMatching, {
    companyId,
    userId,
    actionKey: "batches.release",
    params: {}
  });
  if (started) return started;

  const body = bodySchema.safeParse(json);
  if (!body.success) {
    return { success: false, message: "Invalid request" };
  }
  const ids = [...new Set(body.data.batchIds.filter(Boolean))];
  if (ids.length === 0) {
    return { success: false, message: "No batches selected" };
  }
  if (!fitsOneRequest("batches.release", ids.length)) {
    return startSelectedBulkAction({
      companyId,
      userId,
      actionKey: "batches.release",
      params: {},
      listKey: "operation-batches",
      ids
    });
  }

  const result = await bulkReleaseBatches({
    client,
    db: getDatabaseClient(),
    batchIds: ids,
    companyId,
    userId
  });
  if (!result.success) return result;
  return {
    success: true,
    released: result.done,
    failed: result.failed,
    skipped: result.skipped
  };
}
