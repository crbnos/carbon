import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { revisionValidator } from "~/modules/items/items.models";
import { createRevision, getItem } from "~/modules/items/items.service";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(revisionValidator).validate(formData);

  if (validation.error) {
    return { success: false, error: "Invalid form data" };
  }

  if (!validation.data.copyFromId) {
    return {
      success: false,
      error: "Copy from ID is required for a new revision"
    };
  }

  const currentItem = await getItem(validation.data.copyFromId);

  if (currentItem.error) {
    return { success: false, error: "Failed to get current item" };
  }

  const result = await createRevision({
    item: currentItem.data,
    revision: validation.data.revision
  });

  if (result.error) {
    return { success: false, error: "Failed to create revision" };
  }

  switch (currentItem.data.type) {
    case "Part":
      return { success: true, link: path.to.partDetails(result.data.id) };
    case "Material":
      return {
        success: true,
        link: path.to.materialDetails(result.data.id)
      };
    case "Tool":
      return { success: true, link: path.to.toolDetails(result.data.id) };
    case "Consumable":
      return {
        success: true,
        link: path.to.consumableDetails(result.data.id)
      };
    case "Service":
      return {
        success: true,
        link: path.to.serviceDetails(result.data.id)
      };
    default:
      return { success: true, link: path.to.items };
  }
}
