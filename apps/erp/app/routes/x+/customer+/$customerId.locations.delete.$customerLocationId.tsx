// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { deleteCustomerLocation } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "sales"
  });

  const { customerId, customerLocationId } = params;
  if (!customerId || !customerLocationId) {
    throw redirect(
      path.to.customers,
      await flash(
        request,
        error(params, "Failed to get a customer location id")
      )
    );
  }

  const { error: deleteCustomerLocationError } = await deleteCustomerLocation(
    client,
    customerId,
    customerLocationId
  );
  if (deleteCustomerLocationError) {
    const errorMessage =
      deleteCustomerLocationError.code === "23503"
        ? "Customer location is used elsewhere, cannot delete"
        : "Failed to delete customer location";

    throw redirect(
      path.to.customerLocations(customerId),
      await flash(request, error(deleteCustomerLocationError, errorMessage))
    );
  }

  throw redirect(
    path.to.customerLocations(customerId),
    await flash(request, success("Successfully deleted customer location"))
  );
}
