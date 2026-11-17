// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { deliveryDateCheckValidator } from "~/modules/sales/sales.models";

const logger = getLogger("erp", "sales-order-delivery-date");

// The delivery date check of a sales order line, as the line form holds it.
// A read, so the line form caches it by URL and the order page does not
// revalidate on each edit, as an action would make it.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { orderId } = params;
  const search = new URL(request.url).searchParams;
  const line = deliveryDateCheckValidator.safeParse({
    salesOrderLineId: search.get("salesOrderLineId") || null,
    salesOrderLineType: search.get("salesOrderLineType"),
    itemId: search.get("itemId"),
    locationId: search.get("locationId") || null,
    methodType: search.get("methodType"),
    saleQuantity: Number(search.get("saleQuantity")),
    promisedDate: search.get("promisedDate")
  });
  if (!orderId || !line.success) {
    return {
      data: null,
      error: { message: "The line has nothing the check can read" }
    };
  }

  const api = await carbon(request);
  const result = await api.sales.checkSalesOrderLineDeliveryDate({
    ...line.data,
    salesOrderId: orderId
  });
  if (result.error) {
    logger.error("Delivery date check refused", {
      salesOrderId: orderId,
      error: result.error
    });
  }
  return result;
}

export const clientLoader = cachedClientLoader<typeof loader>();
