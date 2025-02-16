import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { upsertJobOperationParameter } from "~/modules/production";
import { operationParameterValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
  });

  const formData = await request.formData();
  const validation = await validator(operationParameterValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertJobOperationParameter(client, {
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
        error(insert.error, "Failed to insert job operation parameter")
      )
    );
  }

  const jobOperationParameterId = insert.data?.id;
  if (!jobOperationParameterId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insert.error, "Failed to insert job operation parameter")
      )
    );
  }

  return json({ id: jobOperationParameterId });
}
