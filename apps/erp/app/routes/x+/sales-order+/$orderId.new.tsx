import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import { useRouteData, useUser } from "~/hooks";
import type { Customer, SalesOrder, SalesOrderLineType } from "~/modules/sales";
import {
  getSalesOrder,
  isSalesOrderLocked,
  salesOrderLineValidator,
  upsertSalesOrderLine
} from "~/modules/sales";
import { SalesOrderLineForm } from "~/modules/sales/ui/SalesOrder";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });

  const salesOrder = await getSalesOrder(viewClient, orderId);
  await requireUnlocked({
    request,
    isLocked: isSalesOrderLocked(salesOrder.data?.status),
    redirectTo: path.to.salesOrderDetails(orderId),
    message: "Cannot add lines to a locked sales order. Reopen it first."
  });

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(salesOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  if (d.salesOrderLineType === "Comment") {
    d.accountId = undefined;
    d.assetId = undefined;
    d.itemId = undefined;
  } else if (d.salesOrderLineType === "Fixed Asset") {
    d.accountId = undefined;
    d.itemId = undefined;
  } else {
    d.accountId = undefined;
    d.assetId = undefined;
  }

  const createSalesOrderLine = await upsertSalesOrderLine(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createSalesOrderLine.error) {
    throw redirect(
      path.to.salesOrderDetails(orderId),
      await flash(
        request,
        error(createSalesOrderLine.error, "Failed to create sales order line.")
      )
    );
  }

  throw redirect(path.to.salesOrderDetails(orderId));
}

export default function NewSalesOrderLineRoute() {
  const { defaults } = useUser();
  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  const salesOrderData = useRouteData<{
    salesOrder: SalesOrder;
    customer: Customer;
  }>(path.to.salesOrder(orderId));

  const initialValues = {
    salesOrderId: orderId,
    salesOrderLineType: "Part" as SalesOrderLineType,
    itemId: "",
    saleQuantity: 1,
    setupPrice: 0,
    storageUnitId: "",
    unitOfMeasureCode: "",
    unitPrice: 0,
    addOnCost: 0,
    nonTaxableAddOnCost: 0,
    locationId:
      salesOrderData?.salesOrder?.locationId ?? defaults.locationId ?? "",
    taxPercent: salesOrderData?.customer?.taxPercent ?? 0,
    promisedDate:
      salesOrderData?.salesOrder?.receiptPromisedDate ??
      salesOrderData?.salesOrder?.receiptRequestedDate ??
      "",
    shippingCost: 0
  };

  return (
    <SalesOrderLineForm
      // @ts-ignore
      initialValues={initialValues}
    />
  );
}
