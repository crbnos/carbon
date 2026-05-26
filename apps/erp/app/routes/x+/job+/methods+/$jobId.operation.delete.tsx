import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { recalculateJobOperationDependencies } from "~/modules/production/production.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { jobId } = params;
  if (!jobId) {
    return data(
      { error: "Job ID is required" },
      {
        status: 400
      }
    );
  }
  const formData = await request.formData();
  const id = formData.get("id") as string;
  if (!id) {
    return data(
      { error: "Operation ID is required" },
      {
        status: 400
      }
    );
  }

  const { error } = await client.from("jobOperation").delete().eq("id", id);

  if (error) {
    return data(
      { success: false, error: error.message },
      {
        status: 400
      }
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

  return { success: true };
}
