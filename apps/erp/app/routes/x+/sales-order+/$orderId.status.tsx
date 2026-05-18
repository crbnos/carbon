import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { salesOrderStatusType, updateSalesOrderStatus } from "~/modules/sales";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { orderId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof salesOrderStatusType)[number];

  if (!status || !salesOrderStatusType.includes(status)) {
    throw redirect(
      path.to.salesOrderDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const update = await updateSalesOrderStatus({
    id,
    status,
    assignee: ["Closed"].includes(status) ? null : undefined,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesOrderDetails(id),
      await flash(
        request,
        error(update.error, "Failed to update sales order status")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.quote(id),
    await flash(request, success("Updated sales order status"))
  );
}
