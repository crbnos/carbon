import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeNoticeActionStatusValidator,
  updateChangeNoticeActionStatus
} from "~/modules/items";
import {
  requireChangeNoticeChildRoute,
  requireEditableChangeNoticeRoute
} from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const changeNoticeId = params.id;
  if (!changeNoticeId) throw new Error("Could not find id");

  const locked = await requireEditableChangeNoticeRoute(request, {
    client,
    changeNoticeId,
    companyId,
    scope: "workflow"
  });
  if (locked) return locked;

  const formData = await request.formData();
  const validation = await validator(
    changeNoticeActionStatusValidator
  ).validate(formData);

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

  const owned = await requireChangeNoticeChildRoute(request, {
    client,
    table: "changeOrderActionTask",
    id,
    changeNoticeId,
    companyId
  });
  if (owned) return owned;

  const update = await updateChangeNoticeActionStatus(client, {
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
