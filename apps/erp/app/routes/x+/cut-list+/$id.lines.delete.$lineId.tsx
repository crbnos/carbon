import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteCutListLine } from "~/modules/production";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "production"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const { error: deleteError } = await deleteCutListLine(
    client,
    lineId,
    companyId
  );

  if (deleteError) {
    throw redirect(
      path.to.cutList(id),
      await flash(request, error(deleteError, "Failed to delete piece"))
    );
  }

  throw redirect(
    path.to.cutList(id),
    await flash(request, success("Piece deleted"))
  );
}
