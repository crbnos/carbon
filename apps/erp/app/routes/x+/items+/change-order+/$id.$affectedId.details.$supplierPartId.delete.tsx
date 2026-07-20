import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteSupplierPart } from "~/modules/items";
import { path } from "~/utils/path";

// Delete action for a supplier part managed on a CO line. Action-only: the
// ConfirmDelete modal is rendered inline by the embedded Supplier Parts grid
// (deleteSupplierPath), so there is no default export. Redirecting back to the
// CO line detail revalidates the $id loader (refreshing the grid) and carries
// the flash — mirroring the part purchasing delete route's shape.
export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id, affectedId, supplierPartId } = params;
  if (!id) throw notFound("Could not find id");
  if (!affectedId) throw notFound("Could not find affectedId");
  if (!supplierPartId) throw notFound("Could not find supplierPartId");

  const { error: deleteError } = await deleteSupplierPart(
    client,
    supplierPartId,
    companyId
  );

  if (deleteError) {
    throw redirect(
      path.to.changeOrderAffectedItem(id, affectedId),
      await flash(request, error(deleteError, "Failed to delete supplier part"))
    );
  }

  throw redirect(
    path.to.changeOrderAffectedItem(id, affectedId),
    await flash(request, success("Supplier part deleted"))
  );
}
