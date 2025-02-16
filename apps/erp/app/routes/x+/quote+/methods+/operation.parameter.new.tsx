import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { upsertQuoteOperationParameter } from "~/modules/sales";
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

  const insert = await upsertQuoteOperationParameter(client, {
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
        error(insert.error, "Failed to insert quote operation parameter")
      )
    );
  }

  const quoteOperationParameterId = insert.data?.id;
  if (!quoteOperationParameterId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insert.error, "Failed to insert quote operation parameter")
      )
    );
  }

  return json({ id: quoteOperationParameterId });
}
