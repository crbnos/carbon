import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { upsertMethodOperationParameter } from "~/modules/items";
import { operationParameterValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const validation = await validator(operationParameterValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertMethodOperationParameter(client, {
    ...validation.data,
    companyId,
    createdBy: userId,
  });
  if (insert.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insert.error, "Failed to insert method operation parameter")
      )
    );
  }

  const methodOperationParameterId = insert.data?.id;
  if (!methodOperationParameterId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insert.error, "Failed to insert method operation tool")
      )
    );
  }

  return json({ id: methodOperationParameterId });
}
