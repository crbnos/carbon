// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { serverFns } from "@carbon/server-functions";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
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

  const result = await serverFns
    .as({ client, db: getDatabaseClient(), companyId, userId })
    .invoke("recalculate-revenue-recognition-run", { runId });

  if (result.error) {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(
        request,
        error(
          result.error,
          result.error.message ||
            "Failed to recalculate revenue recognition run"
        )
      )
    );
  }

  const { data } = result;
  if (data.deleted) {
    throw redirect(
      path.to.revenueRecognitionRuns,
      await flash(
        request,
        success(
          `Nothing is due by this run's period end any more, so ${data.runId} was deleted`
        )
      )
    );
  }

  throw redirect(
    path.to.revenueRecognitionRun(runId),
    await flash(
      request,
      success(
        data.changed
          ? `Recalculated ${data.runId}: ${data.lineCount} lines`
          : `${data.runId} is already up to date`
      )
    )
  );
}
