import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertQuoteOperationStep } from "~/modules/sales";
import { operationStepValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) {
    return { success: false, message: "Invalid operation attribute id" };
  }

  const formData = await request.formData();
  const validation = await validator(operationStepValidator).validate(formData);

  if (validation.error) {
    return { success: false, message: "Invalid form data" };
  }

  const { id: _id, ...d } = validation.data;

  const update = await upsertQuoteOperationStep({
    id,
    ...d,
    minValue: d.minValue ?? null,
    maxValue: d.maxValue ?? null,
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
        error(update.error, "Failed to update  operation attribute")
      )
    );
  }

  const operationAttributeId = update.data?.id;
  if (!operationAttributeId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(update.error, "Failed to update  operation attribute")
      )
    );
  }

  return data(
    { id: operationAttributeId },
    await flash(request, success("Quote operation attribute updated"))
  );
}
