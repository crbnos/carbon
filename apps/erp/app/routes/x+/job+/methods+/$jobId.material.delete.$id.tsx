import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import {
  deleteJobMaterial,
  recalculateJobOperationDependencies,
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "production",
  });

  const { id, jobId } = params;
  if (!id) {
    throw new Error("id not found");
  }

  if (!jobId) {
    throw new Error("jobId not found");
  }

  const deleteMaterial = await deleteJobMaterial(client, id);
  if (deleteMaterial.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(deleteMaterial.error, "Failed to delete job material")
      )
    );
  }

  const recalculateResult = await recalculateJobOperationDependencies(
    getCarbonServiceRole(),
    {
      jobId,
      companyId,
      userId,
    }
  );

  if (recalculateResult?.error) {
    return json(
      {
        success: false,
        error: "Failed to recalculate job operation dependencies",
      },
      { status: 400 }
    );
  }

  // TODO: if it is a make method -- we should get the tree from the jobMakeMethod with parentMaterialId = id, and delete everything that comes back

  return json({});
}
