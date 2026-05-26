import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { noteValidator } from "~/modules/shared";
import { insertNote } from "~/modules/shared/shared.service.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {});

  const validation = await validator(noteValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { documentId, note } = validation.data;
  const createNote = await insertNote({
    documentId,
    note
  });
  if (createNote.error) {
    throw redirect(
      request.headers.get("Referer") ?? new URL(request.url).pathname,
      await flash(request, error(createNote.error, "Error creating note"))
    );
  }

  throw redirect(
    request.headers.get("Referer") ?? new URL(request.url).pathname
  );
}
