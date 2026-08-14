import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  cancelSalesReturnOrder,
  completeSalesReturnOrder
} from "~/modules/sales";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get("status");

  // Receipt-driven statuses are never set manually — only Cancelled and
  // Completed are valid manual transitions.
  if (status !== "Cancelled" && status !== "Completed") {
    throw redirect(
      requestReferrer(request) ?? path.to.salesReturnOrderDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const result =
    status === "Cancelled"
      ? await cancelSalesReturnOrder(client, { id, companyId, userId })
      : await completeSalesReturnOrder(client, { id, companyId, userId });

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesReturnOrderDetails(id),
      await flash(request, error(result.error, result.error.message))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.salesReturnOrderDetails(id),
    await flash(
      request,
      success(
        status === "Cancelled"
          ? "Cancelled return order"
          : "Completed return order"
      )
    )
  );
}
