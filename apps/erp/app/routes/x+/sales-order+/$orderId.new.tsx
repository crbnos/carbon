// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData, useUser } from "~/hooks";
import { salesOrderLineValidator } from "~/modules/sales/sales.models";
import type {
  Customer,
  SalesOrder,
  SalesOrderLineType
} from "~/modules/sales/types";
import { SalesOrderLineForm } from "~/modules/sales/ui/SalesOrder";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesOrderLineValidator).request(args, {
    params: ["orderId"]
  });
  if ("invalid" in input) return input.invalid;
  const { orderId } = input.params;
  const formData = input.formData ?? new FormData();
  const api = await carbon(args.request);
  const result = await api.sales.createSalesOrderLine({
    ...input.data,
    // The URL order, not the form's copy.
    salesOrderId: orderId,
    customFields: setCustomFields(formData),
    acknowledged: formData.get("acknowledged") === "true"
  });
  // An error is toasted; the violation modal reads `violations`.
  if (!result.data) return result;
  if ("violations" in result.data) return result.data;
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
    serviceStartDate: "",
    serviceEndDate: "",
    shippingCost: 0
  };

  return (
    <SalesOrderLineForm
      // @ts-expect-error
      initialValues={initialValues}
    />
  );
}
