import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { upsertQuoteOperationAttribute } from "~/modules/sales";
import { operationAttributeValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const validation = await validator(operationAttributeValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertQuoteOperationAttribute(client, {
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
        error(insert.error, "Failed to insert quote operation attribute")
      )
    );
  }

  const quoteOperationAttributeId = insert.data?.id;
  if (!quoteOperationAttributeId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insert.error, "Failed to insert quote operation attribute")
      )
    );
  }

  return json({ id: quoteOperationAttributeId });
}
