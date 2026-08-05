import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  deleteJobMaterial,
  recalculateJobOperationDependencies
} from "~/modules/production";

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
  const ids = formData.getAll("ids").map(String).filter(Boolean);

  if (ids.length === 0) {
    return data({ error: "Material IDs are required" }, { status: 400 });
  }

  const deleteMaterials = await deleteJobMaterial(client, ids);
  if (deleteMaterials.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(deleteMaterials.error, "Failed to delete job materials")
      )
    );
  }

  const recalculateResult = await recalculateJobOperationDependencies(
    getCarbonServiceRole(),
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
