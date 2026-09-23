import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeNoticeActionNotesValidator,
  updateChangeNoticeActionNotes
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

  const validation = await validator(changeNoticeActionNotesValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const { id, notes: notesJson } = validation.data;
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

  let notes: Json;
  try {
    notes = JSON.parse(notesJson) as Json;
  } catch (cause) {
    return data(
      { success: false },
      await flash(request, error(cause, "Invalid notes"))
    );
  }

  if (notes === null || typeof notes !== "object" || Array.isArray(notes)) {
    return data(
      { success: false },
      await flash(request, error(null, "Invalid notes"))
    );
  }

  const update = await updateChangeNoticeActionNotes(client, {
    id: actionId,
    changeNoticeId,
    companyId,
    notes,
    userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update notes"))
    );
  }

  return { success: true };
}
