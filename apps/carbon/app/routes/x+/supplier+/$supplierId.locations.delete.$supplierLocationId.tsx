import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteSupplierLocation } from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "purchasing",
  });

  const { supplierId, supplierLocationId } = params;
  if (!supplierId || !supplierLocationId) {
    throw redirect(
      path.to.suppliers,
      await flash(
        request,
        error(params, "Failed to get a supplier location id")
      )
    );
  }

  const { error: deleteSupplierLocationError } = await deleteSupplierLocation(
    client,
    supplierId,
    supplierLocationId
  );
  if (deleteSupplierLocationError) {
    throw redirect(
      path.to.supplierLocations(supplierId),
      await flash(
        request,
        error(deleteSupplierLocationError, "Failed to delete supplier location")
      )
    );
  }

  throw redirect(
    path.to.supplierLocations(supplierId),
    await flash(request, success("Successfully deleted supplier location"))
  );
}
