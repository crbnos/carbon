import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteRequiredAction } from "~/modules/quality/quality.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id } = params;
  if (!id) throw new Error("Required action ID is required");

  await requirePermissions(request, {
    delete: "quality"
  });

  const deleteResult = await deleteRequiredAction(id);

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
