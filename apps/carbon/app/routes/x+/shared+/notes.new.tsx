import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { insertNote, noteValidator } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

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
