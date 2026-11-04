// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor, respond } from "@carbon/api/carbon.server";
import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getExchangeRate } from "~/modules/accounting/accounting.service";
import { getPurchaseOrder } from "~/modules/purchasing/purchasing.service";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  // One authentication for the reads and the operation: an API key's rate
  // limit counts each one. Update, as the operation requires.
  const auth = await requirePermissions(request, { update: "purchasing" });
  const { client, companyId } = auth;

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const purchaseOrder = await getPurchaseOrder(client, orderId);
  if (purchaseOrder.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(purchaseOrder.error, "Failed to load purchase order")
      )
    );
  }

  const currencyCode = purchaseOrder.data?.currencyCode;
  if (!currencyCode) throw new Error("Could not find currencyCode");

  const exchangeRate = await getExchangeRate(client, companyId, currencyCode);
  if (exchangeRate.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(exchangeRate.error, "Failed to get exchange rate")
      )
    );
  }

  // The operation refuses an order in approval or finished, and sends a
  // released order whose total goes above its approved amount back for
  // approval.
  const api = carbonFor(auth);
  const result = await api.purchasing.updatePurchaseOrderExchangeRate({
    id: orderId,
    exchangeRate: exchangeRate.data
  });

  return respond(request, result).redirect(
    path.to.purchaseOrderDetails(orderId),
    { message: "Successfully updated exchange rate" }
  );
}
