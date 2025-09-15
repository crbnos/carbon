import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { upsertQuoteOperationStep } from "~/modules/sales";
import { operationStepValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { id } = params;
  if (!id) {
    return json({ success: false, message: "Invalid operation attribute id" });
  }

  const formData = await request.formData();
  const validation = await validator(operationStepValidator).validate(formData);

  if (validation.error) {
    return json({ success: false, message: "Invalid form data" });
  }

  const { id: _id, ...data } = validation.data;

  const update = await upsertQuoteOperationStep(client, {
    id,
    ...data,
    minValue: data.minValue ?? null,
    maxValue: data.maxValue ?? null,
    companyId,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  });
  if (update.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(update.error, "Failed to update  operation attribute")
      )
    );
  }

  const operationAttributeId = update.data?.id;
  if (!operationAttributeId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(update.error, "Failed to update  operation attribute")
      )
    );
  }

  return json(
    { id: operationAttributeId },
    await flash(request, success("Quote operation attribute updated"))
  );
}
