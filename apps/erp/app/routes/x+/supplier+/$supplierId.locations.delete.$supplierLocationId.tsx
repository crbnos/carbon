// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getDatabaseErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { deleteSupplierLocation } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "purchasing"
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
    const errorMessage = getDatabaseErrorMessage(
      deleteSupplierLocationError,
      "Failed to delete supplier location",
      { referenced: "Supplier location is used elsewhere, cannot delete" }
    );
    throw redirect(
      path.to.supplierLocations(supplierId),
      await flash(request, error(deleteSupplierLocationError, errorMessage))
    );
  }

  throw redirect(
    path.to.supplierLocations(supplierId),
    await flash(request, success("Successfully deleted supplier location"))
  );
}
