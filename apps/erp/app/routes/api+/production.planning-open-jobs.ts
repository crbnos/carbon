// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

const logger = getLogger("erp", "planning-open-jobs");

const planningOpenJobsQueryValidator = z.object({
  itemId: z.string().min(1),
  locationId: z.string().min(1)
});

// The production planning drawer's Open Jobs: one item's make-to-stock jobs at
// one location that are not finished — Draft and Planned (editable) and the
// released ones, listed read-only so an action on them has a row to sit on.
// Read as the caller, so RLS applies. The drawer maps the rows to its weeks.
export async function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).searchParams;
  const parsed = planningOpenJobsQueryValidator.safeParse({
    itemId: search.get("itemId"),
    locationId: search.get("locationId")
  });
  if (!parsed.success) {
    logger.warning("Planning open jobs read refused: bad query", {
      issues: parsed.error.issues
    });
    throw data(
      { error: "itemId and locationId are required" },
      { status: 400 }
    );
  }
  const { itemId, locationId } = parsed.data;

  const { client, companyId } = await authorize(request, {
    "production.materialPlanning": "View"
  });

  const jobs = await client
    .from("job")
    .select("id, jobId, status, quantity, startDate, dueDate, deadlineType")
    .eq("companyId", companyId)
    .eq("itemId", itemId)
    // this page's location only: the rows are editable and charted there
    .eq("locationId", locationId)
    .is("salesOrderId", null)
    .is("salesOrderLineId", null)
    .in("status", ["Draft", "Planned", "Ready", "In Progress", "Paused"]);
  if (jobs.error) {
    logger.error("Failed to read the item's open jobs", {
      itemId,
      locationId,
      error: jobs.error
    });
    throw data({ error: "Failed to load the open jobs" }, { status: 500 });
  }

  return { jobs: jobs.data };
}

export const clientLoader = cachedClientLoader<typeof loader>();
