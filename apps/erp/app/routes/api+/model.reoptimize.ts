import { requirePermissions } from "@carbon/auth/auth.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

// Re-fires the eager optimise for an already-uploaded model — the raw still lives
// in `temp-staging`, so no re-upload is needed. Backs the viewer's "Retry" action
// when a model settled with no GLB (optimise failed / was skipped).
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

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

  await trigger("model-optimize", { modelUploadId, companyId, userId });
  return { success: true };
}
