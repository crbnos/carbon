import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { recalculateJobOperationDependencies } from "~/modules/production/production.service";

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
  const id = formData.get("id") as string | null;
  const ids = [
    ...formData.getAll("ids").map(String),
    ...(id ? [id] : [])
  ].filter(Boolean);
  if (ids.length === 0) {
    return data(
      { error: "Operation ID is required" },
      {
        status: 400
      }
    );
  }

  const events = await client
    .from("productionEvent")
    .select("id", { count: "exact", head: true })
    .in("jobOperationId", ids);
  if (events.error) {
    return data(
      {
        success: false,
        error: "Failed to check for recorded production events"
      },
      { status: 500 }
    );
  }
  if ((events.count ?? 0) > 0) {
    return data(
      {
        success: false,
        error: "Cannot delete an operation that has recorded production events"
      },
      { status: 400 }
    );
  }

  const { error } = await client.from("jobOperation").delete().in("id", ids);

  if (error) {
    return data(
      { success: false, error: error.message },
      {
        status: 400
      }
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

  return { success: true };
}
