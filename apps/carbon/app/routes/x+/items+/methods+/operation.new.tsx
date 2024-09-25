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

  const formData = await request.formData();
  const validation = await validator(methodOperationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertMethodOperation = await upsertMethodOperation(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertMethodOperation.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertMethodOperation.error, "Failed to insert method operation")
      )
    );
  }

  const methodOperationId = insertMethodOperation.data?.id;
  if (!methodOperationId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertMethodOperation, "Failed to insert method operation")
      )
    );
  }

  return json({ id: methodOperationId });
}
