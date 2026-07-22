import { useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { AffectedItemDraft } from "~/modules/items/ui/ChangeOrder";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { path } from "~/utils/path";

// Create drawer for a supplier part on a CO line's draft item (Buy Revision /
// New Part) — reached relatively from the Supplier Parts grid embedded in
// AffectedItemDetail. No action here: the form posts to the part purchasing
// create action (path.to.newPartSupplier(draftItemId)), which returns
// { success } without redirecting, so the CO stays put and loader revalidation
// refreshes the grid in place.
export default function ChangeOrderNewSupplierPartRoute() {
  const { id, affectedId } = useParams();
  if (!id) throw new Error("Could not find id");
  if (!affectedId) throw new Error("Could not find affectedId");

  const routeData = useRouteData<{ affectedItems: AffectedItemDraft[] }>(
    path.to.changeOrder(id)
  );
  const affected =
    routeData?.affectedItems.find((a) => a.affectedItem.id === affectedId) ??
    null;

  const navigate = useNavigate();
  const onClose = () =>
    navigate(path.to.changeOrderAffectedItem(id, affectedId));

  // The grid only renders (and links here) for Part-type lines with partData.
  if (!affected?.partData) return null;

  const initialValues = {
    itemId: affected.draftItemId,
    supplierId: "",
    supplierPartId: "",
    unitPrice: 0,
    supplierUnitOfMeasureCode: "EA",
    minimumOrderQuantity: 1,
    orderMultiple: 1,
    conversionFactor: 1
  };

  return (
    <SupplierPartForm
      type="Part"
      initialValues={initialValues}
      unitOfMeasureCode={affected.partData.partSummary?.unitOfMeasureCode ?? ""}
      onClose={onClose}
    />
  );
}
