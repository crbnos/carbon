import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertQuoteOperationTool } from "~/modules/sales/sales.service.server";
import { operationToolValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(operationToolValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertQuoteOperationTool({
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
        error(insert.error, "Failed to insert quote operation tool")
      )
    );
  }

  const quoteOperationToolId = insert.data?.id;
  if (!quoteOperationToolId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insert.error, "Failed to insert quote operation tool")
      )
    );
  }

  return { id: quoteOperationToolId };
}
