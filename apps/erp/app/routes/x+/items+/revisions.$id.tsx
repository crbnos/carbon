import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { revisionValidator } from "~/modules/items/items.models";
import { updateRevision } from "~/modules/items/items.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { id } = params;
  if (!id) {
    return json({
      success: false,
      message: "Revision ID is required",
    });
  }

  const formData = await request.formData();
  const validation = await validator(revisionValidator).validate(formData);

  if (validation.error) {
    return json({
      success: false,
      message: "Invalid form data",
    });
  }

  const result = await updateRevision(client, {
    id: id,
    revision: validation.data.revision,
    updatedBy: userId,
  });

  if (result.error) {
    return json({
      success: false,
      message: result.error.message || "Failed to update revision",
    });
  }

  return json({
    success: true,
    link: `/x/items/${id}`, // Redirect back to the item
  });
}
