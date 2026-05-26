import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  upsertMethodOperationStep
} from "~/modules/items/items.service.server";
import { operationStepValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) {
    return { success: false, message: "Invalid operation step id" };
  }

  const formData = await request.formData();
  const validation = await validator(operationStepValidator).validate(formData);

  if (validation.error) {
    return { success: false, message: "Invalid form data" };
  }

  const { id: _id, ...d } = validation.data;

  await assertMethodOperationIsDraft(validation.data.operationId);

  const update = await upsertMethodOperationStep({
    id,
    ...d,
    minValue: d.minValue ?? null,
    maxValue: d.maxValue ?? null,
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
        error(update.error, "Failed to update method operation step")
      )
    );
  }

  const methodOperationStepId = update.data?.id;
  if (!methodOperationStepId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(update.error, "Failed to update method operation step")
      )
    );
  }

  return data(
    { id: methodOperationStepId },
    await flash(request, success("Method operation step updated"))
  );
}
