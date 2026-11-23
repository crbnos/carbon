// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  isPurchaseOrderEditLocked,
  purchaseOrderLineDeleteRefusal
} from "~/modules/purchasing/purchasing.models";
import {
  getPurchaseOrder,
  getPurchaseOrderLine
} from "~/modules/purchasing/purchasing.service";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "purchasing"
  });
  const { lineId, orderId } = params;
  if (!lineId) throw notFound("lineId not found");
  if (!orderId) throw notFound("orderId not found");

  const purchaseOrder = await getPurchaseOrder(client, orderId);
  const status = purchaseOrder.data?.status;
  const releasedRefusal = purchaseOrderLineDeleteRefusal(status);
  await requireUnlocked({
    request,
    isLocked: isPurchaseOrderEditLocked(status) || releasedRefusal !== null,
    redirectTo: path.to.purchaseOrderDetails(orderId),
    message:
      releasedRefusal ??
      "Cannot delete lines on a purchase order in approval or completed."
  });

  const purchaseOrderLine = await getPurchaseOrderLine(client, lineId);
  if (purchaseOrderLine.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(purchaseOrderLine.error, "Failed to get purchase order line")
      )
    );
  }

  return { purchaseOrderLine: purchaseOrderLine.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { lineId, orderId } = params;
  if (!lineId) throw notFound("Could not find lineId");
  if (!orderId) throw notFound("Could not find orderId");

  // The operation refuses an order in approval, released or finished, and a
  // line that has been received or invoiced.
  const api = await carbon(request);
  const result = await api.purchasing.deletePurchaseOrderLine({
    purchaseOrderLineId: lineId
  });

  return respond(request, result).redirect(
    path.to.purchaseOrderDetails(orderId),
    { message: "Successfully deleted purchase order line" }
  );
}
