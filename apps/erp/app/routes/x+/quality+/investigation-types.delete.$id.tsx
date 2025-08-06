import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteInvestigationType } from "~/modules/quality";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { id } = params;
  if (!id) throw notFound("Investigation type ID is required");

  const { client } = await requirePermissions(request, {
    delete: "quality",
  });

  const deleteResult = await deleteInvestigationType(client, id);

  if (deleteResult.error) {
    return redirect(
      path.to.investigationTypes,
      await flash(
        request,
        error(deleteResult.error, "Failed to delete investigation type")
      )
    );
  }

  return redirect(
    path.to.investigationTypes,
    await flash(request, success("Investigation type deleted successfully"))
  );
}
