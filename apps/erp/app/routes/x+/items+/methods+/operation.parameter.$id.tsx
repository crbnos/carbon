import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertMethodOperationParameter } from "~/modules/items";
import { operationParameterValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) {
    return { success: false, message: "Invalid operation parameter id" };
  }

  const formData = await request.formData();
  const validation = await validator(operationParameterValidator).validate(
    formData
  );

  if (validation.error) {
    return { success: false, message: "Invalid form data" };
  }

  const { id: _id, ...d } = validation.data;

  const update = await upsertMethodOperationParameter({
    id,
    ...d,
    companyId,
    updatedBy: userId,
    updatedAt: new Date().toISOString()
  });
  if (update.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(update.error, "Failed to update method operation parameter")
      )
    );
  }

  const methodOperationParameterId = update.data?.id;
  if (!methodOperationParameterId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(update.error, "Failed to update method operation parameter")
      )
    );
  }

  return data(
    { id: methodOperationParameterId },
    await flash(request, success("Method operation parameter updated"))
  );
}
