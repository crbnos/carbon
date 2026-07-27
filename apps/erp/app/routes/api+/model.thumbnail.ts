import { requirePermissions } from "@carbon/auth/auth.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

// Regenerate a model's preview thumbnail — re-renders the optimised GLB to a PNG
// (model-thumbnail). Backs the item thumbnail's "Regenerate" action, e.g. when a
// prior generation failed (the render service was down). Any authenticated
// employee may fire it: generating a preview shouldn't require part-edit rights.
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const modelUploadId = formData.get("modelUploadId") as string | null;
  if (!modelUploadId) {
    return data({ success: false }, { status: 400 });
  }

  // Confirm the model belongs to this tenant before firing.
  const model = await client
    .from("modelUpload")
    .select("id")
    .eq("id", modelUploadId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (model.error || !model.data) {
    return data({ success: false }, { status: 404 });
  }

  // `get_part_details` prefers `item.thumbnailPath` over the model's, so a
  // stale/manual item thumbnail (a deleted file shows as a broken image) would
  // mask the regeneration and revert on reload. "Regenerate" is an explicit
  // "use the model's thumbnail" action, so clear the item override → the fresh
  // `modelUpload.thumbnailPath` (written by model-thumbnail) surfaces, and any
  // broken item path stops rendering immediately.
  await client
    .from("item")
    .update({ thumbnailPath: null })
    .eq("modelUploadId", modelUploadId)
    .eq("companyId", companyId);

  await trigger("model-thumbnail", { modelId: modelUploadId, companyId });
  return { success: true };
}
