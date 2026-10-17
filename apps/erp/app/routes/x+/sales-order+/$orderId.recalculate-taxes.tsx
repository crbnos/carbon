// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getSalesOrder, isSalesOrderLocked } from "~/modules/sales";
import { recalculateSalesDocumentTaxes } from "~/modules/sales/sales.server";
import { getDatabaseClient } from "~/services/database.server";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const salesOrder = await getSalesOrder(client, orderId);
  if (salesOrder.error) {
    throw redirect(
      path.to.salesOrderDetails(orderId),
      await flash(
        request,
        error(salesOrder.error, "Failed to load sales order")
      )
    );
  }

  await requireUnlocked({
    request,
    isLocked: isSalesOrderLocked(salesOrder.data?.status),
    redirectTo: path.to.salesOrderDetails(orderId),
    message: "Cannot modify a locked sales order. Reopen it first."
  });

  const result = await recalculateSalesDocumentTaxes(
    client,
    getDatabaseClient(),
    { companyId, userId, document: "salesOrder", documentId: orderId }
  );

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesOrderDetails(orderId),
      await flash(request, error(result.error, "Failed to recalculate taxes"))
    );
  }

  return redirect(
    requestReferrer(request) ?? path.to.salesOrderDetails(orderId),
    await flash(request, success("Recalculated taxes"))
  );
}
