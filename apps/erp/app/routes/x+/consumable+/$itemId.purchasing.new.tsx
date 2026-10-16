// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import { useRouteData } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate, useParams } from "react-router";
import { carbon } from "~/modules/carbon.server";
import type { ConsumableSummary } from "~/modules/items";
import { supplierPartFormValidator } from "~/modules/items";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(supplierPartFormValidator).request(args, {
    params: ["itemId"]
  });
  if ("invalid" in input) return input.invalid;
  const { id: _id, ...supplierPart } = input.data;
  const api = await carbon(args.request);
  return api.items.supplierPart.create({
    ...supplierPart,
    customFields: input.formData && setCustomFields(input.formData)
  });
}

export default function NewConsumableSupplierRoute() {
  const { itemId } = useParams();

  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ consumableSummary: ConsumableSummary }>(
    path.to.consumable(itemId)
  );

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.consumablePurchasing(itemId));

  const initialValues = {
    itemId: itemId,
    supplierId: "",
    supplierConsumableId: "",
    supplierUnitPrice: 0,
    supplierUnitOfMeasureCode: "EA",
    minimumOrderQuantity: 1,
    orderMultiple: 1,
    conversionFactor: 1
  };

  return (
    <SupplierPartForm
      type="Consumable"
      initialValues={initialValues}
      unitOfMeasureCode={routeData?.consumableSummary?.unitOfMeasureCode ?? ""}
      onClose={onClose}
    />
  );
}
