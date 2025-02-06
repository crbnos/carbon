import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { json, redirect, type ActionFunctionArgs } from "@vercel/remix";
import { deleteSavedView } from "~/modules/shared";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteView = await deleteSavedView(client, id);
  if (deleteView.error) {
    return json(
      {
        id: null,
      },
      await flash(request, error(deleteView.error, "Failed to delete view"))
    );
  }

  const referrer = request.headers.get("referer");
  const referrerPath = referrer ? new URL(referrer).pathname : null;

  throw redirect(referrerPath ?? path.to.authenticatedRoot);
}
