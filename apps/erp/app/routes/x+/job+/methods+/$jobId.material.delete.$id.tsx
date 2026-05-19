import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  deleteJobMaterial,
  recalculateJobOperationDependencies
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "production"
  });

  const { id, jobId } = params;
  if (!id) {
    throw new Error("id not found");
  }

  if (!jobId) {
    throw new Error("jobId not found");
  }

  const deleteMaterial = await deleteJobMaterial(id);
  if (deleteMaterial.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(deleteMaterial.error, "Failed to delete job material")
      )
    );
  }

  const recalculateResult = await recalculateJobOperationDependencies({
    jobId
  });

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
