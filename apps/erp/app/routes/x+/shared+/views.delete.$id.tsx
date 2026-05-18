import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteSavedView } from "~/modules/shared";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {});

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteView = await deleteSavedView(id);
  if (deleteView.error) {
    return data(
      {
        id: null
      },
      await flash(request, error(deleteView.error, "Failed to delete view"))
    );
  }

  const referrer = request.headers.get("referer");
  const referrerPath = referrer ? new URL(referrer).pathname : null;

  throw redirect(referrerPath ?? path.to.authenticatedRoot);
}
