import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteSalesOrder } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "sales"
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const salesOrderDelete = await deleteSalesOrder(orderId);

  if (salesOrderDelete.error) {
    return data(
      path.to.salesOrders,
      await flash(
        request,
        error(salesOrderDelete.error, salesOrderDelete.error.message)
      )
    );
  }

  throw redirect(path.to.salesOrders);
}
