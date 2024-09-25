import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { itemValidator, updateItem } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "parts",
  });

  const { type } = params;
  if (!type) throw new Error("Could not find type");

  if (
    !["Part", "Material", "Tool", "Service", "Consumable", "Fixture"].includes(
      type
    )
  ) {
    throw new Error("Invalid type");
  }

  const formData = await request.formData();
  const validation = await validator(itemValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateItem(client, {
    ...validation.data,
    type: type as "Part",
    companyId,
  });

  if (update.error) {
    return json(
      update.error,
      await flash(request, error(update.error, "Failed to update item"))
    );
  }

  return json({ success: true }, await flash(request, success("Updated item")));
}
