import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { parseDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeNoticeActionDueDateValidator,
  updateChangeNoticeActionDueDate
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
    changeNoticeActionDueDateValidator
  ).validate(await request.formData());
  if (validation.error) return validationError(validation.error);

  const { id, dueDate: rawDueDate } = validation.data;
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

  let dueDate: string | null = null;
  if (rawDueDate?.trim()) {
    try {
      dueDate = parseDate(rawDueDate.trim()).toString();
    } catch (cause) {
      return data(
        { success: false },
        await flash(request, error(cause, "Invalid due date"))
      );
    }
  }

  const update = await updateChangeNoticeActionDueDate(client, {
    id: actionId,
    changeNoticeId,
    companyId,
    dueDate,
    userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update due date"))
    );
  }

  return { success: true };
}
