import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import { getUnreleasedChangeOrderIssue } from "~/modules/items/items.server";
import {
  getPurchaseOrder,
  isPurchaseOrderLocked,
  purchaseOrderLineValidator,
  upsertPurchaseOrderLine
} from "~/modules/purchasing";
import { PurchaseOrderLineForm } from "~/modules/purchasing/ui/PurchaseOrder";
import type { MethodItemType } from "~/modules/shared";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  // First check with view permission to verify PO status
  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });

  const purchaseOrder = await getPurchaseOrder(viewClient, orderId);
  if (purchaseOrder.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(purchaseOrder.error, "Failed to load purchase order")
      )
    );
  }

  await requireUnlocked({
    request,
    isLocked: isPurchaseOrderLocked(purchaseOrder.data?.status),
    redirectTo: path.to.purchaseOrderDetails(orderId),
    message: "Cannot modify a confirmed purchase order."
  });

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const formData = await request.formData();
  const validation = await validator(purchaseOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

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

  const createPurchaseOrderLine = await upsertPurchaseOrderLine(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createPurchaseOrderLine.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(
          createPurchaseOrderLine.error,
          "Failed to create purchase order line."
        )
      )
    );
  }

  throw redirect(path.to.purchaseOrderDetails(orderId));
}

export default function NewPurchaseOrderLineRoute() {
  const { orderId } = useParams();

  if (!orderId) throw new Error("Could not find purchase order id");

  const initialValues = {
    conversionFactor: 1,
    exchangeRate: 1,
    inventoryUnitOfMeasureCode: "",
    itemId: "",
    purchaseOrderId: orderId,
    purchaseOrderLineType: "Item" as MethodItemType,
    purchaseQuantity: 1,
    purchaseUnitOfMeasureCode: "",
    requiredDate: undefined,
    setupPrice: 0,
    storageUnitId: "",
    supplierShippingCost: 0,
    supplierTaxAmount: 0,
    supplierUnitPrice: 0,
    taxPercent: 0
  };

  return <PurchaseOrderLineForm initialValues={initialValues} />;
}
