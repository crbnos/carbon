import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { upsertMethodOperationAttribute } from "~/modules/items";
import { operationAttributeValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { id } = params;
  if (!id) {
    return json({ success: false, message: "Invalid operation attribute id" });
  }

  const formData = await request.formData();
  const validation = await validator(operationAttributeValidator).validate(
    formData
  );

  if (validation.error) {
    return json({ success: false, message: "Invalid form data" });
  }

  const { id: _id, ...data } = validation.data;

  const update = await upsertMethodOperationAttribute(client, {
    id,
    ...data,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  });
  if (update.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(update.error, "Failed to update method operation attribute")
      )
    );
  }

  const methodOperationAttributeId = update.data?.id;
  if (!methodOperationAttributeId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(update.error, "Failed to update method operation attribute")
      )
    );
  }

  return json(
    { id: methodOperationAttributeId },
    await flash(request, success("Method operation attribute updated"))
  );
}
