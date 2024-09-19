import { json, redirect } from "@remix-run/react";

import type { ActionFunctionArgs } from "@vercel/remix";
import { deleteSalesOrder } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const salesOrderDelete = await deleteSalesOrder(client, orderId);

  if (salesOrderDelete.error) {
    return json(
      path.to.salesOrders,
      await flash(
        request,
        error(salesOrderDelete.error, "Failed to delete sales order")
      )
    );
  }

  throw redirect(path.to.salesOrders);
}
