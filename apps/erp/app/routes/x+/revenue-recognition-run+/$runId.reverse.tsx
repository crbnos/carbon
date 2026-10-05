// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  RunReversalError,
  resolveReversalPeriods,
  reverseRevenueRecognitionRun
} from "~/modules/accounting/accounting.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { runId } = params;
  if (!runId) {
    throw redirect(
      path.to.revenueRecognitionRuns,
      await flash(request, error(null, "Missing revenue recognition run ID"))
    );
  }

  // Every journal the run posted, through the schedule rows it holds.
  const lines = await client
    .from("revenueRecognitionRunLine")
    .select(
      "schedule:revenueRecognitionSchedule!revenueRecognitionRunLine_schedule_fkey(journal:journalId(postingDate))"
    )
    .eq("runId", runId)
    .eq("companyId", companyId);
  if (lines.error) {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(
        request,
        error(lines.error, "Failed to load revenue recognition run")
      )
    );
  }

  // Each journal reverses on its own date, or today when that period is Closed.
  const periods = await resolveReversalPeriods(client, {
    companyId,
    postingDates: lines.data.flatMap((line) =>
      line.schedule?.journal?.postingDate
        ? [line.schedule.journal.postingDate]
        : []
    )
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

  let reversed: { runId: string };
  try {
    reversed = await reverseRevenueRecognitionRun(getDatabaseClient(), {
      runId,
      periods: periods.data,
      companyId,
      userId
    });
  } catch (err) {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(
        request,
        error(
          err,
          err instanceof RunReversalError
            ? err.message
            : "Failed to reverse revenue recognition run"
        )
      )
    );
  }

  throw redirect(
    path.to.revenueRecognitionRun(runId),
    await flash(
      request,
      success(`Reversed ${reversed.runId}. It is a draft again.`)
    )
  );
}
