import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeNoticeActionAssigneeValidator,
  updateChangeNoticeActionAssignee
} from "~/modules/items";
import { requireChangeNoticeActionTaskEditable } from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id: changeNoticeId, actionId } = params;
  if (!changeNoticeId) throw new Error("Could not find id");
  if (!actionId) throw new Error("Could not find actionId");

  const validation = await validator(
    changeNoticeActionAssigneeValidator
  ).validate(await request.formData());
  if (validation.error) return validationError(validation.error);

  const { id, assignee } = validation.data;
  if (id !== actionId) {
    return data(
      { success: false },
      await flash(request, error("Invalid action ID", "Invalid action ID"))
    );
  }

  const editable = await requireChangeNoticeActionTaskEditable(client, {
    actionTaskId: actionId,
    changeNoticeId,
    companyId
  });
  if (editable) {
    return data(
      { success: false },
      await flash(request, error(editable.error, editable.error.message))
    );
  }

  const update = await updateChangeNoticeActionAssignee(client, {
    id: actionId,
    changeNoticeId,
    companyId,
    assignee: assignee || null,
    userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update assignee"))
    );
  }

  return { success: true };
}
