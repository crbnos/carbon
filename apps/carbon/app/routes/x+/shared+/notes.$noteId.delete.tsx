import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteNote } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {});

  const { noteId } = params;
  if (!noteId) throw new Error("noteId not found");

  const result = await deleteNote(client, noteId);
  if (result.error) {
    throw redirect(
      request.headers.get("Referer") ?? request.url,
      await flash(request, error(result.error, "Error deleting note"))
    );
  }

  throw redirect(request.headers.get("Referer") ?? request.url);
}
