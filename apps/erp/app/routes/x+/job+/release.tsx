// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { bulkReleaseJobs } from "~/modules/production/bulk-actions.server";
import { getDatabaseClient } from "~/services/database.server";
import { fitsOneRequest } from "~/utils/table-jobs";
import {
  startAllMatchingBulkAction,
  startSelectedBulkAction
} from "~/utils/table-jobs.server";

const bodySchema = z.object({ jobIds: z.array(z.string()) });

// Bulk release — the jobs table's "Release Jobs" action. Each selected Draft /
// Planned job goes through the job page's release path (bulkReleaseJobs) on
// its own: a job that is not ready is reported in `failed` while the rest
// still release. A job in any other status (a stale selection) is skipped.
// `{ allMatching: { listKey, search } }` in place of `jobIds` releases every
// matching job in the background job instead, up to 2,000 jobs. More than 25
// selected jobs also go to the background job: each runs MRP, and one request
// must end before the load balancer's 600 s.
// Fetcher-driven; the table toasts the summary and the loader revalidates.
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
    actionKey: "jobs.release",
    params: {}
  });
  if (started) return started;

  const body = bodySchema.safeParse(json);
  if (!body.success) {
    return { success: false as const, message: "Invalid request" };
  }
  const ids = [...new Set(body.data.jobIds.filter(Boolean))];
  if (ids.length === 0) {
    return { success: false as const, message: "No jobs selected" };
  }
  if (!fitsOneRequest("jobs.release", ids.length)) {
    return startSelectedBulkAction({
      companyId,
      userId,
      actionKey: "jobs.release",
      params: {},
      listKey: "jobs",
      ids
    });
  }

  return bulkReleaseJobs({
    client,
    db: getDatabaseClient(),
    jobIds: ids,
    companyId,
    userId
  });
}
