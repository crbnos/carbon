import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteCustomer } from "~/modules/sales/sales.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const customerDelete = await deleteCustomer(customerId);

  if (customerDelete.error) {
    return data(
      path.to.customers,
      await flash(
        request,
        error(customerDelete.error, customerDelete.error.message)
      )
    );
  }

  throw redirect(path.to.customers);
}
