import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { AffectedItemDraft } from "~/modules/items/ui/ChangeOrder";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { path } from "~/utils/path";

// Edit drawer for a supplier part on a CO line's draft item — reached
// relatively from the embedded Supplier Parts grid. The loader mirrors the part
// purchasing edit route ($itemId.purchasing.$supplierPartId): the supplier part
// row + its price breaks (the form re-posts the full price-break set, so they
// MUST be seeded or saving would wipe them) + purchase history. No action here:
// the form posts to the part edit action (path.to.partSupplier), which returns
// { success } so the CO stays put.
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
      .select("quantity, unitPrice, sourceType, sourceDocumentId, createdAt")
      .eq("supplierPartId", supplierPartId)
      .order("quantity", { ascending: true })
  ]);

  if (!supplierPartResult?.data)
    throw new Error("Could not find supplier part");

  const supplierPart = supplierPartResult.data;

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
    priceBreaks: priceBreaksResult.data ?? [],
    purchasingHistory: purchasingHistory.data ?? []
  };
}

export default function ChangeOrderEditSupplierPartRoute() {
  const { id, affectedId } = useParams();
  if (!id) throw new Error("Could not find id");
  if (!affectedId) throw new Error("Could not find affectedId");

  const { supplierPart, priceBreaks, purchasingHistory } =
    useLoaderData<typeof loader>();

  const routeData = useRouteData<{ affectedItems: AffectedItemDraft[] }>(
    path.to.changeOrder(id)
  );
  const affected =
    routeData?.affectedItems.find((a) => a.affectedItem.id === affectedId) ??
    null;

  const navigate = useNavigate();
  const onClose = () =>
    navigate(path.to.changeOrderAffectedItem(id, affectedId));

  const initialValues = {
    id: supplierPart.id,
    itemId: supplierPart.itemId,
    supplierId: supplierPart.supplierId,
    supplierPartId: supplierPart.supplierPartId ?? "",
    unitPrice: supplierPart.unitPrice ?? 0,
    supplierUnitOfMeasureCode: supplierPart.supplierUnitOfMeasureCode ?? "EA",
    minimumOrderQuantity: supplierPart.minimumOrderQuantity ?? 1,
    orderMultiple: supplierPart.orderMultiple ?? 1,
    conversionFactor: supplierPart.conversionFactor ?? 1
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
