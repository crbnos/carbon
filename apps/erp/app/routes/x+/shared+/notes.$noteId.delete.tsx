import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteNote } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {});

  const { noteId } = params;
  if (!noteId) throw new Error("noteId not found");

  const result = await deleteNote(client, noteId);
  if (result.error) {
    throw redirect(
      request.headers.get("Referer") ?? new URL(request.url).pathname,
      await flash(request, error(result.error, "Error deleting note"))
    );
  }

  throw redirect(
    request.headers.get("Referer") ?? new URL(request.url).pathname
  );
}
