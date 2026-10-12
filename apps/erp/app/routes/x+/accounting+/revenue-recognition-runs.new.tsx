// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { serverFns } from "@carbon/server-functions";
import { datetime, redirect } from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";

import { revenueRecognitionRunValidator } from "~/modules/accounting";
import { futureRunPeriodError } from "~/modules/accounting/accounting.server";
import { getNextRevenueRecognitionPeriodEnd } from "~/modules/accounting/accounting.utils";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  // The list page posts the period it showed; a bare POST falls back to the
  // period after the last run (posted or draft).
  const formData = await request.formData();
  const validation = await validator(revenueRecognitionRunValidator).validate(
    formData
  );

  let periodEnd: string;
  if (validation.error) {
    const lastRun = await client
      .from("revenueRecognitionRun")
      .select("periodEnd")
      .eq("companyId", companyId)
      .order("periodEnd", { ascending: false })
      .limit(1);

    const lastPeriodEnd =
      lastRun.data && lastRun.data.length > 0
        ? lastRun.data[0].periodEnd
        : null;

    periodEnd = getNextRevenueRecognitionPeriodEnd(
      lastPeriodEnd,
      datetime.today(await getCompanyTimeZone(client, companyId)).toString()
    );
  } else {
    // Schedule rows fall on month ends, so a picked day means its month: a
    // mid-month date would leave that month's rows out ("Nothing to
    // recognize"). Depreciation runs snap the same way.
    periodEnd = endOfMonth(
      parseDate(validation.data.periodEnd.slice(0, 10))
    ).toString();
  }

  const futureError = await futureRunPeriodError(client, companyId, periodEnd);
  if (futureError) {
    throw redirect(
      path.to.revenueRecognitionRuns,
      await flash(request, error(null, futureError))
    );
  }

  // A period can have more than one run (a second picks up rows that fell
  // due after the first posted), but only one Draft at a time.
  const existingDraft = await client
    .from("revenueRecognitionRun")
    .select("id, runId")
    .eq("periodEnd", periodEnd)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .maybeSingle();

  if (existingDraft.data) {
    throw redirect(
      path.to.revenueRecognitionRun(existingDraft.data.id),
      await flash(
        request,
        error(
          null,
          `${existingDraft.data.runId} is already a draft for this period. Recalculate it instead.`
        )
      )
    );
  }

  try {
    const proposal = await serverFns
      .system({ db: getDatabaseClient(), companyId, userId })
      .invokeOrThrow("propose-revenue-recognition-run", { periodEnd });

    if (!proposal) {
      throw redirect(
        path.to.revenueRecognitionRuns,
        await flash(
          request,
          error(null, "Nothing to recognize for this period")
        )
      );
    }

    throw redirect(
      path.to.revenueRecognitionRun(proposal.id),
      await flash(request, success("Revenue recognition run created"))
    );
  } catch (e) {
    if (e instanceof Response) throw e;
    throw redirect(
      path.to.revenueRecognitionRuns,
      await flash(request, error(e, "Failed to create revenue recognition run"))
    );
  }
}
