import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

/**
 * Cancels a stuck convert or plan job for the instruction's model by failing
 * its Processing rows, so the retry/generate buttons re-enable. This releases
 * the UI state only — an Inngest run that is genuinely still working isn't
 * killed, but a later completion just overwrites the failed marker, which is
 * harmless. The common case is a job orphaned by a geometry-service outage.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const kind = String(formData.get("kind"));
  if (kind !== "convert" && kind !== "plan") {
    return data(
      { success: false },
      await flash(request, error(null, "Invalid job kind"))
    );
  }

  const instruction = await client
    .from("assemblyInstruction")
    .select("modelUploadId")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();

  if (instruction.error || !instruction.data.modelUploadId) {
    return data(
      { success: false },
      await flash(
        request,
        error(instruction.error, "This instruction has no model")
      )
    );
  }
  const modelUploadId = instruction.data.modelUploadId;

  const cancelled = await client
    .from("assemblyPlanJob")
    .update({
      status: "Failed",
      error: "Cancelled by user",
      updatedAt: new Date().toISOString()
    })
    .eq("modelUploadId", modelUploadId)
    .eq("companyId", companyId)
    .eq("kind", kind)
    .eq("status", "Processing")
    .select("id");

  if (cancelled.error) {
    return data(
      { success: false },
      await flash(request, error(cancelled.error, "Could not cancel the job"))
    );
  }

  if (kind === "convert") {
    await client
      .from("modelUpload")
      .update({
        processingStatus: "Failed",
        processingError: "Cancelled by user"
      })
      .eq("id", modelUploadId)
      .eq("companyId", companyId)
      .in("processingStatus", ["Queued", "Processing"]);
  }

  return data(
    { success: true },
    await flash(
      request,
      success(
        cancelled.data.length > 0 ? "Job cancelled" : "No running job to cancel"
      )
    )
  );
}
