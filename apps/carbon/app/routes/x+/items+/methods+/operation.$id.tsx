import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import {
  methodOperationValidator,
  upsertMethodOperation,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

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
