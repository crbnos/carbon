import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { revisionValidator } from "~/modules/items/items.models";
import { createRevision, getItem } from "~/modules/items/items.service";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
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

  const currentItem = await getItem(client, validation.data.copyFromId);

  if (currentItem.error) {
    return { success: false, error: "Failed to get current item" };
  }

  const result = await createRevision(getCarbonServiceRole(), {
    item: currentItem.data,
    revision: validation.data.revision,
    createdBy: userId
  });

  if (result.error) {
    return { success: false, error: "Failed to create revision" };
  }

  const link = (() => {
    switch (currentItem.data.type) {
      case "Part":
        return path.to.partDetails(result.data.id);
      case "Material":
        return path.to.materialDetails(result.data.id);
      case "Tool":
        return path.to.toolDetails(result.data.id);
      case "Consumable":
        return path.to.consumableDetails(result.data.id);
      case "Service":
        return path.to.serviceDetails(result.data.id);
      default:
        return path.to.items;
    }
  })();

  // newItemId lets the caller (e.g. the new-revision modal's "open change order"
  // option) act on the created revision without parsing it out of `link`.
  return { success: true, link, newItemId: result.data.id };
}
