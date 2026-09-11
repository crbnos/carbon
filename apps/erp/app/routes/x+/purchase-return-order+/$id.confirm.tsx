import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  confirmPurchaseReturnOrder,
  getPurchaseReturnOrder
} from "~/modules/purchasing";
import { generateAndAttachPurchaseReturnOrderPdf } from "~/modules/shared/shared.server";
import { getDatabaseClient } from "~/services/database.server";

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { companyId, userId } = await requirePermissions(request, {
    update: "purchasing",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const serviceRole = getCarbonServiceRole();

  const purchaseReturnOrder = await getPurchaseReturnOrder(serviceRole, id);
  if (purchaseReturnOrder.error || !purchaseReturnOrder.data) {
    return data(
      { success: false },
      await flash(
        request,
        error(purchaseReturnOrder.error, "Failed to load purchase return order")
      )
    );
  }

  if (purchaseReturnOrder.data.companyId !== companyId) {
    return data(
      { success: false },
      await flash(
        request,
        error(null, "You are not authorized to confirm this return order")
      )
    );
  }

  try {
    // Throws on cap violations (reversible-quantity checks run under row locks)
    await confirmPurchaseReturnOrder(
      getDatabaseClient(),
      { id, companyId },
      userId
    );
  } catch (err) {
    return data(
      { success: false },
      await flash(
        request,
        error(
          err,
          err instanceof Error ? err.message : "Failed to confirm return order"
        )
      )
    );
  }

  try {
    await generateAndAttachPurchaseReturnOrderPdf(serviceRole, {
      routeArgs: args,
      id,
      purchaseReturnOrderIdentifier:
        purchaseReturnOrder.data.purchaseReturnOrderId ?? "",
      companyId,
      userId
    });
  } catch (err) {
    // The order is confirmed at this point — surface the PDF failure without
    // pretending the confirm failed.
    return data(
      { success: true },
      await flash(
        request,
        error(err, "Return order confirmed, but the PDF could not be generated")
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Return order confirmed"))
  );
}
