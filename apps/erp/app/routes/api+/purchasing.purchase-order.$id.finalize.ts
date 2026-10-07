// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getPurchaseOrder, getSupplier } from "~/modules/purchasing";
import { getCompanySettings } from "~/modules/settings";

const logger = getLogger("erp", "api-purchase-order-finalize");

/**
 * What `PurchaseOrderFinalizeModal` needs when it is opened away from the
 * purchase order's own page (the planning pages): the order, and the CC list
 * the PO page would default to — the supplier's own, else the company's.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { id } = params;
  if (!id) {
    return data(
      { purchaseOrder: null, defaultCc: [] as string[] },
      { status: 400 }
    );
  }

  const purchaseOrder = await getPurchaseOrder(client, id);
  if (purchaseOrder.error || purchaseOrder.data?.companyId !== companyId) {
    logger.error("Failed to read the purchase order to finalize", {
      companyId,
      purchaseOrderId: id,
      error: purchaseOrder.error
    });
    return data(
      { purchaseOrder: null, defaultCc: [] as string[] },
      { status: purchaseOrder.error ? 500 : 404 }
    );
  }

  const [supplier, companySettings] = await Promise.all([
    purchaseOrder.data.supplierId
      ? getSupplier(client, purchaseOrder.data.supplierId)
      : null,
    getCompanySettings(getCarbonServiceRole(), companyId)
  ]);

  const defaultCc = supplier?.data?.defaultCc?.length
    ? supplier.data.defaultCc
    : (companySettings.data?.defaultSupplierCc ?? []);

  return { purchaseOrder: purchaseOrder.data, defaultCc };
}

export const clientLoader = cachedClientLoader<typeof loader>();
