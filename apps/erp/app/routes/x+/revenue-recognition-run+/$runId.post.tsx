// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { fetchAllRecords } from "@carbon/database";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";

import {
  futureRunPeriodError,
  postRevenueRecognitionRun,
  RunOutOfDateError,
  resolveRunPostingPeriods
} from "~/modules/accounting/accounting.server";
import { monthEndOf } from "~/modules/accounting/accounting.utils";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      update: "accounting"
    });

  const { runId } = params;
  if (!runId) {
    throw redirect(
      path.to.revenueRecognitionRuns,
      await flash(request, error(null, "Missing revenue recognition run ID"))
    );
  }

  const run = await client
    .from("revenueRecognitionRun")
    .select("*")
    .eq("id", runId)
    .eq("companyId", companyId)
    .single();

  if (run.error || run.data.status !== "Draft") {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(request, error(run.error, "Run is not in Draft status"))
    );
  }

  const futureError = await futureRunPeriodError(
    client,
    companyId,
    run.data.periodEnd
  );
  if (futureError) {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(request, error(null, futureError))
    );
  }

  // Each row posts in the period of the month it was scheduled for (the
  // run's own period when that month is Closed).
  const [scheduledLines, dimensionsResult] = await Promise.all([
    // A run claims every due row of the company: past PostgREST's 1000-row
    // cap, an unread month would have no period and fail the post.
    fetchAllRecords(() =>
      client
        .from("revenueRecognitionRunLine")
        .select(
          "id, schedule:revenueRecognitionSchedule!revenueRecognitionRunLine_schedule_fkey(scheduledDate)"
        )
        .eq("runId", runId)
        .eq("companyId", companyId)
        .order("id")
    ),
    client
      .from("dimension")
      .select("id, entityType")
      .eq("companyGroupId", companyGroupId)
      .eq("active", true)
  ]);
  if (scheduledLines.error || !scheduledLines.data) {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(
        request,
        error(scheduledLines.error, "Failed to load revenue recognition run")
      )
    );
  }

  const periods = await resolveRunPostingPeriods(client, {
    companyId,
    monthEnds: scheduledLines.data.flatMap((line) =>
      line.schedule ? [monthEndOf(line.schedule.scheduledDate)] : []
    ),
    runPeriodEnd: run.data.periodEnd
  });
  if (!periods.data) {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(
        request,
        error(periods.error, "Failed to get accounting period")
      )
    );
  }

  const dimensions = dimensionsResult.data ?? [];
  const dimensionIds = {
    customer: dimensions.find((d) => d.entityType === "Customer")?.id,
    item: dimensions.find((d) => d.entityType === "Item")?.id,
    location: dimensions.find((d) => d.entityType === "Location")?.id,
    project: dimensions.find((d) => d.entityType === "Project")?.id
  };

  try {
    await postRevenueRecognitionRun(getDatabaseClient(), {
      runId,
      companyId,
      userId,
      periods: periods.data,
      dimensionIds
    });
  } catch (err) {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(
        request,
        error(
          err,
          err instanceof RunOutOfDateError
            ? err.message
            : "Failed to post revenue recognition run"
        )
      )
    );
  }

  throw redirect(
    path.to.revenueRecognitionRun(runId),
    await flash(request, success("Revenue recognition run posted"))
  );
}
