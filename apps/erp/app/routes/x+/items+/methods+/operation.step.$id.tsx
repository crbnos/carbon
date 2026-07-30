import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  upsertMethodOperationStep
} from "~/modules/items";
import { checkRevisionLock } from "~/modules/items/items.server";
import { operationStepValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  // Release-lock gate: enforce -> block; warn -> proceed + flash; off -> no-op.
  const lock = await checkRevisionLock(client, {
    kind: "operation",
    id: validation.data.operationId,
    companyId
  });
  if (!lock.ok) {
    return { success: false, message: lock.message };
  }

  await assertMethodOperationIsDraft(client, validation.data.operationId);

  const update = await upsertMethodOperationStep(client, {
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
    await flash(
      request,
      success(lock.warn ? lock.message : "Method operation step updated")
    )
  );
}
