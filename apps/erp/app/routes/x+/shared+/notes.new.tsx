import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { insertNote, noteValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const validation = await validator(noteValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { documentId, note } = validation.data;
  const createNote = await insertNote(client, {
    documentId,
    note,
    companyId,
    createdBy: userId,
  });
  if (createNote.error) {
    throw redirect(
      request.headers.get("Referer") ?? request.url,
      await flash(request, error(createNote.error, "Error creating note"))
    );
  }

  throw redirect(request.headers.get("Referer") ?? request.url);
}
