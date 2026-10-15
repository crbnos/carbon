// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { AffectedItemDraft } from "~/modules/items/ui/ChangeNotice";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { getCustomFields } from "~/utils/form";
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

export default function ChangeNoticeEditSupplierPartRoute() {
  const { id, affectedId } = useParams();
  if (!id) throw new Error("Could not find id");
  if (!affectedId) throw new Error("Could not find affectedId");

  const { supplierPart, priceBreaks, purchasingHistory } =
    useLoaderData<typeof loader>();

  const routeData = useRouteData<{ affectedItems: AffectedItemDraft[] }>(
    path.to.changeNotice(id)
  );
  const affected =
    routeData?.affectedItems.find((a) => a.affectedItem.id === affectedId) ??
    null;

  const navigate = useNavigate();
  const onClose = () =>
    navigate(path.to.changeNoticeAffectedItem(id, affectedId));

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
      type="Part"
      initialValues={initialValues}
      unitOfMeasureCode={
        affected?.partData?.partSummary?.unitOfMeasureCode ?? ""
      }
      priceBreaks={priceBreaks}
      purchasingHistory={purchasingHistory}
      onClose={onClose}
    />
  );
}
