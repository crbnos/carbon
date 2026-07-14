import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteMemo } from "~/modules/invoicing";
import { path } from "~/utils/path";

// Action-only route — the delete confirmation modal (ConfirmDelete) posts here.
// The memo table's RLS DELETE policy restricts deletes to Draft memos, so a
// non-draft delete fails at the database; the UI also hides the action.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "invoicing"
  });

  const { memoId } = params;
  if (!memoId) {
    throw redirect(
      path.to.memos,
      await flash(request, error(params, "Failed to get a memo id"))
    );
  }

  const remove = await deleteMemo(client, memoId);
  if (remove.error) {
    throw redirect(
      path.to.memo(memoId),
      await flash(request, error(remove.error, "Failed to delete memo"))
    );
  }

  throw redirect(
    path.to.memos,
    await flash(request, success("Successfully deleted memo"))
  );
}
