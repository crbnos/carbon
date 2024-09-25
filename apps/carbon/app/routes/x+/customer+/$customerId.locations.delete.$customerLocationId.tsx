import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteCustomerLocation } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "sales",
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
    throw redirect(
      path.to.customerLocations(customerId),
      await flash(
        request,
        error(deleteCustomerLocationError, "Failed to delete customer location")
      )
    );
  }

  throw redirect(
    path.to.customerLocations(customerId),
    await flash(request, success("Successfully deleted customer location"))
  );
}
