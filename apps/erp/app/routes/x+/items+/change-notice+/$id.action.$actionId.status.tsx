import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeOrderActionStatusValidator,
  updateChangeOrderActionStatus
} from "~/modules/items";
import {
  requireChangeOrderChildRoute,
  requireEditableChangeOrderRoute
} from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const changeOrderId = params.id;
  if (!changeOrderId) throw new Error("Could not find id");

  const locked = await requireEditableChangeOrderRoute(request, {
    client,
    changeOrderId,
    companyId,
    scope: "workflow"
  });
  if (locked) return locked;

  const formData = await request.formData();
  const validation = await validator(changeOrderActionStatusValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, status } = validation.data;
  if (id !== params.actionId) {
    return data(
      { success: false },
      await flash(request, error("Invalid action ID", "Invalid action ID"))
    );
  }

  const owned = await requireChangeOrderChildRoute(request, {
    client,
    table: "changeOrderActionTask",
    id,
    changeOrderId,
    companyId
  });
  if (owned) return owned;

  const update = await updateChangeOrderActionStatus(client, {
    id,
    status,
    userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update status"))
    );
  }

  return { success: true };
}
