import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyStandardNoteValidator,
  upsertAssemblyStandardNote
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { noteId } = params;
  if (!noteId) throw new Error("noteId is not found");

  const validation = await validator(assemblyStandardNoteValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await upsertAssemblyStandardNote(client, {
    ...validation.data,
    id: noteId,
    companyId,
    createdBy: userId,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(update.error, "Failed to update standard note")
      )
    );
  }

  return { success: true };
}
