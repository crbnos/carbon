import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { upsertJobOperationAttribute } from "~/modules/production";
import { operationAttributeValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
  });

  const formData = await request.formData();
  const validation = await validator(operationAttributeValidator).validate(
    formData
  );

  console.log({ validation });

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertJobOperationAttribute(client, {
    ...validation.data,
    companyId,
    createdBy: userId,
  });

  console.log({ insert });

  if (insert.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insert.error, "Failed to insert job operation attribute")
      )
    );
  }

  const jobOperationAttributeId = insert.data?.id;
  if (!jobOperationAttributeId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insert.error, "Failed to insert job operation attribute")
      )
    );
  }

  return json({ id: jobOperationAttributeId });
}
