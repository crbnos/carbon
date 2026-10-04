// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { insertNote, noteValidator } from "~/modules/shared";
import { requestReferrer } from "~/utils/path";

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
    createdBy: userId
  });
  if (createNote.error) {
    throw redirect(
      requestReferrer(request) ?? new URL(request.url).pathname,
      await flash(request, error(createNote.error, "Error creating note"))
    );
  }

  throw redirect(requestReferrer(request) ?? new URL(request.url).pathname);
}
