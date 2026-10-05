// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  buildDepreciationRunLines,
  insertDepreciationRun
} from "~/modules/accounting";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "accounting"
    });

  const { depreciationRunId } = params;
  if (!depreciationRunId) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(null, "Missing depreciation run ID"))
    );
  }

  // Get the source run to find its period
  const sourceRun = await client
    .from("depreciationRun")
    .select("periodEnd, status")
    .eq("id", depreciationRunId)
    .single();

  if (sourceRun.error) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(request, error(sourceRun.error, "Failed to load source run"))
    );
  }

  if (sourceRun.data.status !== "Posted") {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(request, error(null, "Only posted runs can be repeated"))
    );
  }

  const periodEnd = sourceRun.data.periodEnd;

  // No runId: every run already at this period covers its assets, so the
  // repeat holds only the active assets none of them does.
  const proposal = await buildDepreciationRunLines(client, {
    companyId,
    companyGroupId,
    periodEnd
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
  const { lines } = proposal.data;

  if (lines.length === 0) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(
          null,
          "Every active asset is already covered for this period, or has nothing to depreciate"
        )
      )
    );
  }

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
        error(result.error, "Failed to create repeat depreciation run")
      )
    );
  }

  throw redirect(
    path.to.depreciationRun(result.data.id),
    await flash(request, success("Repeat depreciation run created"))
  );
}
