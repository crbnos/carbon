import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

/**
 * Cancels a running/stuck convert or plan job: fails its Processing rows (the
 * retry/generate buttons re-enable) AND cancels the job on the assembler —
 * which marks it terminal (the compute result is dropped, never uploaded) and
 * fires the completion callback, so the waiting Inngest run wakes and fails
 * fast with a non-retriable "canceled" instead of retrying or later
 * overwriting these rows with a success.
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

  // Best-effort: tell the assembler. Without this the job keeps computing and
  // its success callback would resurrect the run; with it the store marks the
  // job canceled (terminal), drops the result, and notifies the waiter.
  if (ASSEMBLER_SERVICE_URL && cancelled.data.length > 0) {
    await Promise.allSettled(
      cancelled.data.map((job) =>
        fetch(`${ASSEMBLER_SERVICE_URL}/v1/jobs/${job.id}/cancel`, {
          method: "POST",
          headers: ASSEMBLER_SERVICE_API_KEY
            ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
            : {},
          signal: AbortSignal.timeout(5000)
        })
      )
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
