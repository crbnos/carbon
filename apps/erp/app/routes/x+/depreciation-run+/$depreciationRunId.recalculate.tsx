// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { buildDepreciationRunLines } from "~/modules/accounting";
import { replaceDepreciationRunLines } from "~/modules/accounting/accounting.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      update: "accounting"
    });

  const { depreciationRunId } = params;
  if (!depreciationRunId) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(null, "Missing depreciation run ID"))
    );
  }

  const run = await client
    .from("depreciationRun")
    .select("depreciationRunId, periodEnd, status")
    .eq("id", depreciationRunId)
    .eq("companyId", companyId)
    .single();
  if (run.error || run.data.status !== "Draft") {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(request, error(run.error, "Run is not in Draft status"))
    );
  }

  const proposal = await buildDepreciationRunLines(client, {
    companyId,
    companyGroupId,
    periodEnd: run.data.periodEnd,
    runId: depreciationRunId
  });
  if (!proposal.data) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(proposal.error, "Failed to calculate depreciation")
      )
    );
  }
  if (proposal.data.laterPostedRunId) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(
          null,
          `${proposal.data.laterPostedRunId} is already posted for a later period and includes these months; delete ${run.data.depreciationRunId}`
        )
      )
    );
  }

  let result: Awaited<ReturnType<typeof replaceDepreciationRunLines>>;
  try {
    result = await replaceDepreciationRunLines(getDatabaseClient(), {
      depreciationRunId,
      lines: proposal.data.lines,
      companyId,
      userId
    });
  } catch (err) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(request, error(err, "Failed to recalculate depreciation run"))
    );
  }

  if (result.deleted) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        success(
          `Nothing is left to depreciate for this period, so ${run.data.depreciationRunId} was deleted`
        )
      )
    );
  }

  throw redirect(
    path.to.depreciationRun(depreciationRunId),
    await flash(
      request,
      success(
        result.changed
          ? `Recalculated ${run.data.depreciationRunId}: ${proposal.data.lines.length} lines`
          : `${run.data.depreciationRunId} is already up to date`
      )
    )
  );
}
