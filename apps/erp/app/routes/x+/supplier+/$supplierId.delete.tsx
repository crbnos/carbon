import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteSupplier } from "~/modules/purchasing/purchasing.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const supplierDelete = await deleteSupplier(supplierId);

  if (supplierDelete.error) {
    return data(
      path.to.suppliers,
      await flash(
        request,
        error(supplierDelete.error, supplierDelete.error.message)
      )
    );
  }

  throw redirect(path.to.suppliers);
}
