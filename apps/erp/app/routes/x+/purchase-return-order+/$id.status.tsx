import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  cancelPurchaseReturnOrder,
  completePurchaseReturnOrder
} from "~/modules/purchasing";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get("status");

  // Shipment-driven statuses are never set manually — only Cancelled and
  // Completed are valid manual transitions.
  if (status !== "Cancelled" && status !== "Completed") {
    throw redirect(
      requestReferrer(request) ?? path.to.purchaseReturnOrderDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  try {
    // Kysely transactions (row-locked against concurrent shipment posting) —
    // they THROW on a guard violation.
    if (status === "Cancelled") {
      await cancelPurchaseReturnOrder(getDatabaseClient(), {
        id,
        companyId,
        userId
      });
    } else {
      await completePurchaseReturnOrder(getDatabaseClient(), {
        id,
        companyId,
        userId
      });
    }
  } catch (err) {
    throw redirect(
      requestReferrer(request) ?? path.to.purchaseReturnOrderDetails(id),
      await flash(
        request,
        error(
          err,
          err instanceof Error ? err.message : "Failed to update status"
        )
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.purchaseReturnOrderDetails(id),
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
