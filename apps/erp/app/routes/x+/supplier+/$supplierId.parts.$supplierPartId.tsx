// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { isSupplierPartItemType } from "~/modules/items/ui/Item/SupplierPartForm";
import { getCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId, supplierPartId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");
  if (!supplierPartId) throw new Error("Could not find supplierPartId");

  const [supplierPartResult, priceBreaksResult] = await Promise.all([
    client
      .from("supplierPart")
      .select("*, item(type, unitOfMeasureCode)")
      .eq("id", supplierPartId)
      .eq("supplierId", supplierId)
      .eq("companyId", companyId)
      .single(),
    client
      .from("supplierPartPrice")
      .select("quantity, unitPrice, sourceType, sourceDocumentId, createdAt")
      .eq("supplierPartId", supplierPartId)
      .order("quantity", { ascending: true })
  ]);

  const supplierPart = supplierPartResult.data;
  if (!supplierPart || !isSupplierPartItemType(supplierPart.item?.type)) {
    throw redirect(
      path.to.supplierParts(supplierId),
      await flash(
        request,
        error(supplierPartResult.error, "Failed to load supplier part")
      )
    );
  }

  // The form posts its price breaks back in full and the save replaces the
  // stored ones, so an unread list must not reach it as an empty one.
  if (priceBreaksResult.error) {
    throw redirect(
      path.to.supplierParts(supplierId),
      await flash(
        request,
        error(priceBreaksResult.error, "Failed to load supplier price breaks")
      )
    );
  }

  const purchasingHistory = await client
    .from("purchaseOrderLine")
    .select(
      "id, purchaseQuantity, unitPrice, purchaseOrderId, purchaseOrder!inner(purchaseOrderId, supplierId, orderDate)"
    )
    .eq("itemId", supplierPart.itemId)
    .eq("purchaseOrder.supplierId", supplierPart.supplierId)
    .order("createdAt", { ascending: false })
    .limit(10);

  return {
    supplierPart,
    itemType: supplierPart.item.type,
    unitOfMeasureCode: supplierPart.item.unitOfMeasureCode ?? "",
    priceBreaks: priceBreaksResult.data ?? [],
    purchasingHistory: purchasingHistory.data ?? []
  };
}

export default function SupplierEditSupplierPartRoute() {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("Could not find supplierId");

  const {
    supplierPart,
    itemType,
    unitOfMeasureCode,
    priceBreaks,
    purchasingHistory
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.supplierParts(supplierId));

  const initialValues = {
    id: supplierPart.id,
    itemId: supplierPart.itemId,
    supplierId: supplierPart.supplierId,
    supplierPartId: supplierPart.supplierPartId ?? "",
    unitPrice: supplierPart.unitPrice ?? 0,
    supplierUnitOfMeasureCode: supplierPart.supplierUnitOfMeasureCode ?? "EA",
    minimumOrderQuantity: supplierPart.minimumOrderQuantity ?? 1,
    orderMultiple: supplierPart.orderMultiple ?? 1,
    conversionFactor: supplierPart.conversionFactor ?? 1,
    ...getCustomFields(supplierPart.customFields)
  };

  return (
    <SupplierPartForm
      type={itemType}
      initialValues={initialValues}
      unitOfMeasureCode={unitOfMeasureCode}
      priceBreaks={priceBreaks}
      purchasingHistory={purchasingHistory}
      onClose={onClose}
    />
  );
}
