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
  RunReversalError,
  resolveReversalPeriods,
  reverseDepreciationRun
} from "~/modules/accounting/accounting.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { depreciationRunId } = params;
  if (!depreciationRunId) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(null, "Missing depreciation run ID"))
    );
  }

  // Every journal the run posted: each month's, and each month's deferred tax.
  // One line per asset per month: past PostgREST's 1000-row cap.
  const lines = await fetchAllRecords(() =>
    client
      .from("depreciationRunLine")
      .select(
        "id, journal:journalId(postingDate), deferredTaxJournal:deferredTaxJournalId(postingDate)"
      )
      .eq("depreciationRunId", depreciationRunId)
      .eq("companyId", companyId)
      .order("id")
  );
  if (lines.error || !lines.data) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(lines.error, "Failed to load depreciation run")
      )
    );
  }

  // Each journal reverses on its own date, or today when that period is Closed.
  const periods = await resolveReversalPeriods(client, {
    companyId,
    postingDates: lines.data.flatMap((line) =>
      [line.journal?.postingDate, line.deferredTaxJournal?.postingDate].filter(
        (date): date is string => Boolean(date)
      )
    )
  });
  if (!periods.data) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(periods.error, "Failed to get accounting period")
      )
    );
  }

  let reversed: { depreciationRunId: string };
  try {
    reversed = await reverseDepreciationRun(getDatabaseClient(), {
      depreciationRunId,
      periods: periods.data,
      companyId,
      userId
    });
  } catch (err) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(
          err,
          err instanceof RunReversalError
            ? err.message
            : "Failed to reverse depreciation run"
        )
      )
    );
  }

  throw redirect(
    path.to.depreciationRun(depreciationRunId),
    await flash(
      request,
      success(`Reversed ${reversed.depreciationRunId}. It is a draft again.`)
    )
  );
}
