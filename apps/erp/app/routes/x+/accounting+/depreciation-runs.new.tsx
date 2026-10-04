// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import {
  depreciationRunValidator,
  insertDepreciationRun
} from "~/modules/accounting";
import {
  buildDepreciationRunLines,
  futureRunPeriodError
} from "~/modules/accounting/accounting.server";
import { getNextPeriodEnd } from "~/modules/accounting/accounting.utils";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "accounting"
    });

  // Find the last run (posted or draft) to determine the next period
  const lastRun = await client
    .from("depreciationRun")
    .select("periodEnd, status")
    .eq("companyId", companyId)
    .order("periodEnd", { ascending: false })
    .limit(1);

  const lastPeriodEnd =
    lastRun.data && lastRun.data.length > 0 ? lastRun.data[0].periodEnd : null;

  // The list page posts the period the user picked; a bare POST falls back to
  // the period after the last run. Depreciation is monthly, so the picked
  // date snaps to its month end, and it must come after the last run — the
  // calculation depreciates every month from the last posted run up to it.
  const validation = await validator(depreciationRunValidator).validate(
    await request.formData()
  );
  const periodEnd = validation.error
    ? getNextPeriodEnd(lastPeriodEnd)
    : endOfMonth(parseDate(validation.data.periodEnd)).toString();

  if (lastPeriodEnd && periodEnd <= lastPeriodEnd) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(null, "The period must end after the last depreciation run")
      )
    );
  }

  const futureError = await futureRunPeriodError(client, companyId, periodEnd);
  if (futureError) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(null, futureError))
    );
  }

  // Check for existing run at this period
  const existing = await client
    .from("depreciationRun")
    .select("id")
    .eq("periodEnd", periodEnd)
    .eq("companyId", companyId);

  if (existing.data && existing.data.length > 0) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(null, "A depreciation run already exists for this period")
      )
    );
  }

  const proposal = await buildDepreciationRunLines(client, {
    companyId,
    companyGroupId,
    periodEnd
  });
  if (!proposal.data) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(proposal.error, "Failed to calculate depreciation")
      )
    );
  }
  const { lines } = proposal.data;

  const result = await insertDepreciationRun(client, {
    periodEnd,
    lines,
    companyId,
    createdBy: userId
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(result.error, "Failed to create depreciation run")
      )
    );
  }

  throw redirect(
    path.to.depreciationRun(result.data.id),
    await flash(request, success("Depreciation run created"))
  );
}
