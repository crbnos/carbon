import { useCarbon } from "@carbon/auth";
import { useCallback } from "react";
import { usePermissions } from "~/hooks";
import type { BuyMethod } from "~/modules/items";

export default function useBuyMethods() {
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const canEdit = permissions.can("update", "parts");
  const canDelete = permissions.can("delete", "parts");

  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: BuyMethod) => {
      if (!carbon) throw new Error("Carbon client not found");
      return await carbon
        .from("buyMethod")
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
