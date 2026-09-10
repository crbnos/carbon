import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  cancelPurchaseReturnOrder,
  completePurchaseReturnOrder,
  reopenPurchaseReturnOrder
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

  // Shipment-driven statuses are never set manually — only Cancelled, Completed,
  // and Draft (reopen a confirmed return) are valid manual transitions.
  if (status !== "Cancelled" && status !== "Completed" && status !== "Draft") {
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
    } else if (status === "Completed") {
      await completePurchaseReturnOrder(getDatabaseClient(), {
        id,
        companyId,
        userId
      });
    } else {
      await reopenPurchaseReturnOrder(getDatabaseClient(), {
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
          : status === "Completed"
            ? "Completed return order"
            : "Reopened return order"
      )
    )
  );
}
