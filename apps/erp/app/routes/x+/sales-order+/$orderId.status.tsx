import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  cancelSalesOrder,
  salesOrderStatusType,
  updateSalesOrderStatus
} from "~/modules/sales";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
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

  // Cancel flow routes through the dedicated service function so MCP /
  // scripts can call the same code path with the same semantics.
  if (status === "Cancelled") {
    // The modal sends "cancelJobIds" as a comma-separated string. The
    // presence of the field (even when empty) signals "user explicitly
    // chose which jobs". Absence signals "no preference — cancel all".
    const cancelJobIdsRaw = formData.get("cancelJobIds") as string | null;
    const jobs =
      cancelJobIdsRaw === null
        ? undefined
        : cancelJobIdsRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);

    const result = await cancelSalesOrder(client, { id, userId, jobs });

    if (!result.success) {
      throw redirect(
        requestReferrer(request) ?? path.to.salesOrderDetails(id),
        await flash(request, error(null, result.message))
      );
    }

    throw redirect(
      requestReferrer(request) ?? path.to.quote(id),
      await flash(request, success(result.message))
    );
  }

  const update = await updateSalesOrderStatus(client, {
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
