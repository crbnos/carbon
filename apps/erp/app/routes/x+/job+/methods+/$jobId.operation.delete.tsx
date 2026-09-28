import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteJobOperationWithDependencies } from "~/modules/production/production.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  const result = await deleteJobOperationWithDependencies(client, {
    id,
    jobId,
    companyId,
    userId
  });
  if (result.error) {
    return data(
      { success: false, error: result.error.message },
      { status: 400 }
    );
  }

  return { success: true };
}
