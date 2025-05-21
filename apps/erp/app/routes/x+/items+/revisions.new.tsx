import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { revisionValidator } from "~/modules/items/items.models";
import { createRevision, getItem } from "~/modules/items/items.service";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const validation = await validator(revisionValidator).validate(formData);

  if (validation.error) {
    return json({ success: false, error: "Invalid form data" });
  }

  if (!validation.data.copyFromId) {
    return json({
      success: false,
      error: "Copy from ID is required for a new revision",
    });
  }

  const currentItem = await getItem(client, validation.data.copyFromId);

  if (currentItem.error) {
    return json({ success: false, error: "Failed to get current item" });
  }

  const result = await createRevision(getCarbonServiceRole(), {
    item: currentItem.data,
    revision: validation.data.revision,
    createdBy: userId,
  });

  if (result.error) {
    return json({ success: false, error: "Failed to create revision" });
  }

  switch (currentItem.data.type) {
    case "Part":
      return json({ success: true, link: path.to.partDetails(result.data.id) });
    case "Material":
      return json({
        success: true,
        link: path.to.materialDetails(result.data.id),
      });
    case "Tool":
      return json({ success: true, link: path.to.toolDetails(result.data.id) });
    case "Consumable":
      return json({
        success: true,
        link: path.to.consumableDetails(result.data.id),
      });
    case "Service":
      return json({
        success: true,
        link: path.to.serviceDetails(result.data.id),
      });
    default:
      return json({ success: true, link: path.to.items });
  }
}
