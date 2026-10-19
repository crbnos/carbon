// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validationError, validator } from "@carbon/form";
import { useRouteData } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate, useParams } from "react-router";
import { supplierPartFormValidator } from "~/modules/items/items.models";
import type { PartSummary } from "~/modules/items/types";
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
  const result = await api.items.createSupplierPart({
    ...supplierPart,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // One supplier part per item and supplier: shown under the Supplier field.
  if (result.error?.category === "conflict") {
    return validationError({
      fieldErrors: { supplierId: result.error.message }
    });
  }
  return result;
}

export default function NewPartSupplierRoute() {
  const { itemId } = useParams();

  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );

  const initialValues = {
    itemId: itemId,
    supplierId: "",
    supplierPartId: "",
    supplierUnitPrice: 0,
    supplierUnitOfMeasureCode: "EA",
    minimumOrderQuantity: 1,
    orderMultiple: 1,
    conversionFactor: 1
  };

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.partPurchasing(itemId));

  return (
    <SupplierPartForm
      type="Part"
      initialValues={initialValues}
      unitOfMeasureCode={routeData?.partSummary?.unitOfMeasureCode ?? ""}
      onClose={onClose}
    />
  );
}
