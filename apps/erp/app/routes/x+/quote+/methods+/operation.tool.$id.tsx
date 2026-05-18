import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertQuoteOperationTool } from "~/modules/sales";
import { operationToolValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) {
    return { success: false, message: "Invalid operation tool id" };
  }

  const formData = await request.formData();
  const validation = await validator(operationToolValidator).validate(formData);

  if (validation.error) {
    return { success: false, message: "Invalid form data" };
  }

  const { id: _id, ...d } = validation.data;

  const update = await upsertQuoteOperationTool({
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
        error(update.error, "Failed to update  operation tool")
      )
    );
  }

  const operationToolId = update.data?.id;
  if (!operationToolId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(update.error, "Failed to update  operation tool")
      )
    );
  }

  return data(
    { id: operationToolId },
    await flash(request, success("Quote operation tool updated"))
  );
}
