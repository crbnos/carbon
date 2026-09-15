import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { createReplacementSalesOrder } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "sales"
    });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  // Idempotent: re-invoking returns the existing replacement order's id.
  const result = await createReplacementSalesOrder(client, {
    salesReturnOrderId: id,
    companyId,
    companyGroupId,
    userId
  });

  if (result.error || !result.data) {
    return data(
      { success: false },
      await flash(
        request,
        error(result.error, "Failed to create replacement order")
      )
    );
  }

  throw redirect(
    path.to.salesOrder(result.data.id),
    await flash(request, success("Replacement order created"))
  );
}
