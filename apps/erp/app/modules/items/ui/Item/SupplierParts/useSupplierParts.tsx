import { useCarbon } from "@carbon/auth";
import { useCallback } from "react";
import { usePermissions } from "~/hooks";
import type { SupplierPart } from "../../../types";

type Part = Pick<
  SupplierPart,
  | "id"
  | "supplierId"
  | "supplierPartId"
  | "unitPrice"
  | "supplierUnitOfMeasureCode"
  | "minimumOrderQuantity"
  | "conversionFactor"
  | "customFields"
>;

export default function useSupplierParts() {
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const canEdit = permissions.can("update", "parts");
  const canDelete = permissions.can("delete", "parts");

  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: Part) => {
      if (!carbon) throw new Error("Carbon client not found");
      return await carbon
        .from("supplierPart")
        .update({
          [id]: value,
        })
        .eq("id", row.id);
    },
    [carbon]
  );

  return {
    canDelete,
    canEdit,
    carbon,
    onCellEdit,
  };
}
