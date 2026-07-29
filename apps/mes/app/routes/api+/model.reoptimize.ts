import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

// Fires the eager optimise for an already-uploaded model — backs the model
// tab's "Load Preview" action (parity with the ERP api+/model.reoptimize
// route). Operators can view models, so any authenticated employee may
// generate the preview.
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const modelUploadId = formData.get("modelUploadId") as string | null;
  if (!modelUploadId) {
    return data({ success: false }, { status: 400 });
  }

  // Confirm the model belongs to this tenant (RLS-scoped read) before firing.
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
  // model — the job refuses to redo a Success row (alreadyOptimized guard), so
  // reset the status first. optimizedModelPath is kept: the viewer serves the
  // old GLB until the fresh one overwrites it (client cache-busts on optimizedAt).
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
