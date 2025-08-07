import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteRequiredAction } from "~/modules/quality";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id } = params;
  if (!id) throw new Error("Required action ID is required");

  const { client } = await requirePermissions(request, {
    delete: "quality",
  });

  const deleteResult = await deleteRequiredAction(client, id);

  if (deleteResult.error) {
    return redirect(
      path.to.requiredActions,
      await flash(
        request,
        error(deleteResult.error, "Failed to delete required action")
      )
    );
  }

  return redirect(
    path.to.requiredActions,
    await flash(request, success("Required action deleted successfully"))
  );
}