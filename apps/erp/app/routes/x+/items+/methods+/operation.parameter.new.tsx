import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertMethodOperationParameter } from "~/modules/items";
import { operationParameterValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(operationParameterValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertMethodOperationParameter({
    ...validation.data,
    companyId,
    createdBy: userId
  });
  if (insert.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert method operation parameter")
      )
    );
  }

  const methodOperationParameterId = insert.data?.id;
  if (!methodOperationParameterId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert method operation parameter")
      )
    );
  }

  return { id: methodOperationParameterId };
}
