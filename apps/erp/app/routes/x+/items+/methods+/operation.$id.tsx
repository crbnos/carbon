import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import {
  methodOperationValidator,
  upsertMethodOperation,
} from "~/modules/items";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const formData = await request.formData();
  const validation = await validator(methodOperationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMethodOperation = await upsertMethodOperation(client, {
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateMethodOperation.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateMethodOperation.error, "Failed to update method operation")
      )
    );
  }

  const methodOperationId = updateMethodOperation.data?.id;
  if (!methodOperationId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateMethodOperation, "Failed to update method operation")
      )
    );
  }

  return json({ id: methodOperationId });
}
