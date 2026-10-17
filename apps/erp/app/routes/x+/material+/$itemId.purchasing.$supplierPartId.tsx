// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { useRouteData } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { supplierPartFormValidator } from "~/modules/items/items.models";
import type { MaterialSummary } from "~/modules/items/types";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { supplierPartId } = params;
  if (!supplierPartId) throw new Error("Could not find supplierPartId");

  const [supplierPartResult, priceBreaksResult] = await Promise.all([
    client
      .from("supplierPart")
      .select("*")
      .eq("id", supplierPartId)
      .eq("companyId", companyId)
      .single(),
    client
      .from("supplierPartPrice")
      .select(
        "quantity, supplierUnitPrice, leadTime, sourceType, sourceDocumentId, createdAt"
      )
      .eq("supplierPartId", supplierPartId)
      .order("quantity", { ascending: true })
  ]);

  if (!supplierPartResult?.data)
    throw new Error("Could not find supplier part");

  const supplierPart = supplierPartResult.data;

  const purchasingHistory = await client
    .from("purchaseOrderLine")
    .select(
      "id, purchaseQuantity, supplierUnitPrice, purchaseOrderId, purchaseOrder!inner(purchaseOrderId, supplierId, orderDate, currencyCode)"
    )
    .eq("itemId", supplierPart.itemId)
    .eq("purchaseOrder.supplierId", supplierPart.supplierId)
    .order("createdAt", { ascending: false })
    .limit(10);

  return {
    supplierPart,
    priceBreaks: priceBreaksResult.data ?? [],
    purchasingHistory: purchasingHistory.data ?? []
  };
}

// Answers with the result rather than redirecting, so a drawer opened
// outside the item page (a supplier's parts, a change notice) stays put.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(supplierPartFormValidator).request(args, {
    params: ["itemId", "supplierPartId"]
  });
  if ("invalid" in input) return input.invalid;
  const { id: _id, ...supplierPart } = input.data;
  const api = await carbon(args.request);
  const result = await api.items.updateSupplierPart({
    ...supplierPart,
    id: input.params.supplierPartId,
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

export default function EditMaterialSupplierRoute() {
  const { itemId } = useParams();
  const { supplierPart, priceBreaks, purchasingHistory } =
    useLoaderData<typeof loader>();

  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ materialSummary: MaterialSummary }>(
    path.to.material(itemId)
  );

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.materialPurchasing(itemId));

  const initialValues = {
    id: supplierPart.id,
    itemId: supplierPart.itemId,
    supplierId: supplierPart.supplierId,
    supplierPartId: supplierPart.supplierPartId ?? "",
    currencyCode: supplierPart.currencyCode ?? undefined,
    supplierUnitPrice: supplierPart.supplierUnitPrice ?? 0,
    supplierUnitOfMeasureCode: supplierPart.supplierUnitOfMeasureCode ?? "EA",
    minimumOrderQuantity: supplierPart.minimumOrderQuantity ?? 1,
    orderMultiple: supplierPart.orderMultiple ?? 1,
    conversionFactor: supplierPart.conversionFactor ?? 1,
    ...getCustomFields(supplierPart.customFields)
  };

  return (
    <SupplierPartForm
      type="Material"
      initialValues={initialValues}
      unitOfMeasureCode={routeData?.materialSummary?.unitOfMeasureCode ?? ""}
      priceBreaks={priceBreaks}
      purchasingHistory={purchasingHistory}
      onClose={onClose}
    />
  );
}
