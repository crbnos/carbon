import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertMethodOperationTool } from "~/modules/items";
import { checkRevisionLock } from "~/modules/items/items.server";
import { operationToolValidator } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
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

  // Release-lock gate: enforce -> block; warn -> proceed + flash; off -> no-op.
  const lock = await checkRevisionLock(client, { kind: "tool", id, companyId });
  if (!lock.ok) {
    return data({ id: null }, await flash(request, error(null, lock.message)));
  }

  const update = await upsertMethodOperationTool(client, {
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
        error(update.error, "Failed to update method operation tool")
      )
    );
  }

  const methodOperationToolId = update.data?.id;
  if (!methodOperationToolId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(update.error, "Failed to update method operation tool")
      )
    );
  }

  return data(
    { id: methodOperationToolId },
    await flash(
      request,
      success(lock.warn ? lock.message : "Method operation tool updated")
    )
  );
}
