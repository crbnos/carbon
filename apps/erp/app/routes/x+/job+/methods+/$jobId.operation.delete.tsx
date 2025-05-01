import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { recalculateJobOperationDependencies } from "~/modules/production/production.service";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "production",
  });

  const { jobId } = params;
  if (!jobId) {
    return json(
      { error: "Job ID is required" },
      {
        status: 400,
      }
    );
  }
  const formData = await request.formData();
  const id = formData.get("id") as string;
  if (!id) {
    return json(
      { error: "Operation ID is required" },
      {
        status: 400,
      }
    );
  }

  const { error } = await client.from("jobOperation").delete().eq("id", id);

  if (error) {
    return json(
      { success: false, error: error.message },
      {
        status: 400,
      }
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

  return json({ success: true });
}
