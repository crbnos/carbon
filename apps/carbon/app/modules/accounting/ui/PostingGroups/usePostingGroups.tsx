import { useCarbon } from "@carbon/auth";
import { useCallback } from "react";
import { usePermissions } from "~/hooks";
import type {
  InventoryPostingGroup,
  PurchasingPostingGroup,
  SalesPostingGroup,
} from "../../types";

export default function usePostingGroups(table: string) {
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const canEdit = permissions.can("update", "accounting");
  const canDelete = permissions.can("delete", "accounting");

  const onCellEdit = useCallback(
    async (
      id: string,
      value: unknown,
      row: PurchasingPostingGroup | SalesPostingGroup | InventoryPostingGroup
    ) => {
      if (!carbon) throw new Error("Carbon client not found");
      return await carbon
        // @ts-ignore
        .from(table)
        .update({
          [id]: value,
        })
        .eq("id", row.id);
    },
    [carbon, table]
  );

  return {
    canDelete,
    canEdit,
    carbon,
    onCellEdit,
  };
}
