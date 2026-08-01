import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

// Re-fires the eager optimise for an already-uploaded model — the raw still lives
// in `temp-staging`, so no re-upload is needed. Backs the viewer's "Retry" action
// when a model settled with no GLB (optimise failed / was skipped).
// Any authenticated employee may fire it: the preview auto-generates on
// view (viewing is the intent), which must not require part-edit rights.
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const modelUploadId = formData.get("modelUploadId") as string | null;
  if (!modelUploadId) {
    return data({ success: false }, { status: 400 });
  }

  // Confirm the model belongs to this tenant (RLS-scoped read) before re-firing.
  const model = await client
    .from("modelUpload")
    .select("id")
    .eq("id", modelUploadId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (model.error || !model.data) {
    return data({ success: false }, { status: 404 });
  }

  // Force mode (the badge's refresh action): re-optimise an already-Successful
  // model — e.g. to pick up improved tessellation/quality settings. The job
  // refuses to redo a Success row (alreadyOptimized guard), so reset the status
  // first. optimizedModelPath is kept: the viewer serves the old GLB until the
  // fresh one overwrites it (same path; the client cache-busts on optimizedAt).
  const force = formData.get("force") === "true";
  if (force) {
    const serviceRole = getCarbonServiceRole();
    await serviceRole
      .from("modelUpload")
      .update({ optimizeStatus: "Queued", optimizeError: null })
      .eq("id", modelUploadId);
  }

  await trigger("model-optimize", { modelUploadId, companyId, userId, force });
  return { success: true };
}
