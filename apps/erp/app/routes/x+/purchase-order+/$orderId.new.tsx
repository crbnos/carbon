// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { getUnreleasedChangeOrderIssue } from "~/modules/items/items.service";
import { purchaseOrderLineValidator } from "~/modules/purchasing/purchasing.models";
import type { PurchaseOrder } from "~/modules/purchasing/types";
import { PurchaseOrderLineForm } from "~/modules/purchasing/ui/PurchaseOrder";
import type { MethodItemType } from "~/modules/shared/types";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const { companyId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const formData = await request.formData();
  const validation = await validator(purchaseOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...d } = validation.data;

  // An item a change notice is still holding is not purchasable — it is a draft
  // revision the supplier has never been shown. Checked here rather than only in
  // the picker because this action is also reached by the API and the MCP tools.
  if (d.itemId) {
    const unreleasedIssue = await getUnreleasedChangeOrderIssue(
      getCarbonServiceRole(),
      { itemId: d.itemId, companyId }
    );
    if (unreleasedIssue) {
      return validationError({
        fieldErrors: { itemId: `${unreleasedIssue} It cannot be purchased.` }
      });
    }
  }

  // The operation refuses an order in approval or finished, and sends a
  // released order whose total goes above its approved amount back for
  // approval.
  const api = await carbon(request);
  const result = await api.purchasing.createPurchaseOrderLine({
    ...d,
    purchaseOrderId: orderId,
    customFields: setCustomFields(formData)
  });

  return respond(request, result).redirect(
    path.to.purchaseOrderDetails(orderId)
  );
}

export default function NewPurchaseOrderLineRoute() {
  const { orderId } = useParams();

  if (!orderId) throw new Error("Could not find purchase order id");

  const routeData = useRouteData<{ purchaseOrder: PurchaseOrder }>(
    path.to.purchaseOrder(orderId)
  );

  const initialValues = {
    conversionFactor: 1,
    exchangeRate: 1,
    inventoryUnitOfMeasureCode: "",
    itemId: "",
    purchaseOrderId: orderId,
    // See PurchaseOrderExplorer — "Item" is the picker's generic mode and is
    // not a valid line type.
    purchaseOrderLineType: "Part" as MethodItemType,
    purchaseQuantity: 1,
    purchaseUnitOfMeasureCode: "",
    requiredDate: routeData?.purchaseOrder?.receiptRequestedDate ?? undefined,
    promisedDate: routeData?.purchaseOrder?.receiptPromisedDate ?? undefined,
    setupPrice: 0,
    storageUnitId: "",
    supplierShippingCost: 0,
    supplierTaxAmount: 0,
    supplierUnitPrice: 0,
    taxPercent: 0
  };

  return <PurchaseOrderLineForm initialValues={initialValues} />;
}
