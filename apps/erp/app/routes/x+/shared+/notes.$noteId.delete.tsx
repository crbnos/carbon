// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { deleteNote } from "~/modules/shared";
import { requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {});

  const { noteId } = params;
  if (!noteId) throw new Error("noteId not found");

  const result = await deleteNote(client, noteId);
  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? new URL(request.url).pathname,
      await flash(request, error(result.error, "Error deleting note"))
    );
  }

  throw redirect(requestReferrer(request) ?? new URL(request.url).pathname);
}
