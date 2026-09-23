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
import { requireChangeNoticeActionTaskEditable } from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const changeNoticeId = params.id;
  if (!changeNoticeId) throw new Error("Could not find id");

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

  const editable = await requireChangeNoticeActionTaskEditable(client, {
    actionTaskId: id,
    changeNoticeId,
    companyId
  });
  if (editable) {
    return data(
      { success: false },
      await flash(request, error(editable.error, editable.error.message))
    );
  }

  const update = await updateChangeNoticeActionStatus(client, {
    id,
    changeNoticeId,
    companyId,
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
