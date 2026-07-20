import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  methodOperationValidator,
  upsertMethodOperation
} from "~/modules/items";
import { checkRevisionLock } from "~/modules/items/items.server";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
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

  // Release-lock gate: enforce -> block; warn -> proceed + flash; off -> no-op.
  const lock = await checkRevisionLock(client, {
    kind: "makeMethod",
    id: validation.data.makeMethodId,
    companyId
  });
  if (!lock.ok) {
    return validationError({
      fieldErrors: { description: lock.message }
    });
  }

  const updateMethodOperation = await upsertMethodOperation(client, {
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateMethodOperation.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateMethodOperation.error, "Failed to update method operation")
      )
    );
  }

  const methodOperationId = updateMethodOperation.data?.id;
  if (!methodOperationId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateMethodOperation, "Failed to update method operation")
      )
    );
  }

  const result = {
    id: methodOperationId,
    success: true,
    message: "Operation updated"
  };

  if (lock.warn) {
    return data(result, await flash(request, success(lock.message)));
  }

  return result;
}
