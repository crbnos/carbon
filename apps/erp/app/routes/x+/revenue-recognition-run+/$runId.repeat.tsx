// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { serverFns } from "@carbon/server-functions";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { futureRunPeriodError } from "~/modules/accounting/accounting.server";
import { getNextPeriodEnd } from "~/modules/accounting/accounting.utils";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const { runId } = params;
  if (!runId) {
    throw redirect(
      path.to.revenueRecognitionRuns,
      await flash(request, error(null, "Missing revenue recognition run ID"))
    );
  }

  // Get the source run to find its period
  const sourceRun = await client
    .from("revenueRecognitionRun")
    .select("periodEnd, status")
    .eq("id", runId)
    .eq("companyId", companyId)
    .single();

  if (sourceRun.error) {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(request, error(sourceRun.error, "Failed to load source run"))
    );
  }

  if (sourceRun.data.status !== "Posted") {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(request, error(null, "Only posted runs can be repeated"))
    );
  }

  const periodEnd = getNextPeriodEnd(sourceRun.data.periodEnd);

  const futureError = await futureRunPeriodError(client, companyId, periodEnd);
  if (futureError) {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
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
        path.to.revenueRecognitionRun(runId),
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
      path.to.revenueRecognitionRun(runId),
      await flash(request, error(e, "Failed to create revenue recognition run"))
    );
  }
}
