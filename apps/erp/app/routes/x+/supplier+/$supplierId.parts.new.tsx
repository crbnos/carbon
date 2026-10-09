// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData } from "@carbon/react";
import { useNavigate, useParams } from "react-router";
import type { SupplierPartWithItem } from "~/modules/items";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { path } from "~/utils/path";

// The form posts to the picked item's own create route, so this route has no
// action; the item decides the type and the inventory unit.
export default function SupplierNewSupplierPartRoute() {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("Could not find supplierId");

  // The Parts tab already loaded this supplier's parts: one per item at most.
  const routeData = useRouteData<{ supplierParts: SupplierPartWithItem[] }>(
    path.to.supplierParts(supplierId)
  );
  const excludeItemIds = routeData?.supplierParts.map((part) => part.itemId);

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.supplierParts(supplierId));

  const initialValues = {
    itemId: "",
    supplierId,
    supplierPartId: "",
    unitPrice: 0,
    supplierUnitOfMeasureCode: "EA",
    minimumOrderQuantity: 1,
    orderMultiple: 1,
    conversionFactor: 1
  };

  return (
    <SupplierPartForm
      selectItem
      excludeItemIds={excludeItemIds}
      type="Part"
      initialValues={initialValues}
      unitOfMeasureCode=""
      onClose={onClose}
    />
  );
}
