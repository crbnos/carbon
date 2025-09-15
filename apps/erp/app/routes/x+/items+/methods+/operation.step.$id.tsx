import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { upsertMethodOperationStep } from "~/modules/items";
import { operationStepValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { id } = params;
  if (!id) {
    return json({ success: false, message: "Invalid operation step id" });
  }

  const formData = await request.formData();
  const validation = await validator(operationStepValidator).validate(formData);

  if (validation.error) {
    return json({ success: false, message: "Invalid form data" });
  }

  const { id: _id, ...data } = validation.data;

  const update = await upsertMethodOperationStep(client, {
    id,
    ...data,
    minValue: data.minValue ?? null,
    maxValue: data.maxValue ?? null,
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
        error(update.error, "Failed to update method operation step")
      )
    );
  }

  const methodOperationStepId = update.data?.id;
  if (!methodOperationStepId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(update.error, "Failed to update method operation step")
      )
    );
  }

  return json(
    { id: methodOperationStepId },
    await flash(request, success("Method operation step updated"))
  );
}
