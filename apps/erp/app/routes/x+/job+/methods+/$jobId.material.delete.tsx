// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { recalculateJobOperationDependencies } from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";

// Deletes one or more materials of the job: the form carries an `id` per
// material, so the bill of material's "Delete Selected" is a single request and
// the job's dependencies are recalculated once.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "production"
  });

  const { jobId } = params;
  if (!jobId) {
    throw new Error("jobId not found");
  }

  const formData = await request.formData();
  const ids = formData.getAll("id").map(String).filter(Boolean);
  if (ids.length === 0) {
    throw new Error("id not found");
  }

  const deleteMaterials = await client
    .from("jobMaterial")
    .delete()
    .in("id", ids)
    .eq("jobId", jobId)
    .eq("companyId", companyId);
  if (deleteMaterials.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(deleteMaterials.error, "Failed to delete job material")
      )
    );
  }

  const recalculateResult = await recalculateJobOperationDependencies(
    getCarbonServiceRole(),
    getDatabaseClient(),
    {
      jobId,
      companyId,
      userId
    }
  );

  if (recalculateResult?.error) {
    return data(
      {
        success: false,
        error: "Failed to recalculate job operation dependencies"
      },
      { status: 400 }
    );
  }

  return {};
}
