import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteAssemblyStandardNote } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { noteId } = params;
  if (!noteId) throw new Error("noteId is not found");

  const deleteNote = await deleteAssemblyStandardNote(client, noteId);
  if (deleteNote.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(deleteNote.error, "Failed to delete standard note")
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Successfully deleted standard note"))
  );
}
