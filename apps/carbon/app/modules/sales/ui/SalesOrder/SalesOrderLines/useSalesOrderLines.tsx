import { useCallback } from "react";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { SalesOrderLine } from "~/modules/sales";

export default function useSalesOrderLines() {
  const { id: userId } = useUser();
  const { supabase } = useSupabase();
  const permissions = usePermissions();

  const canEdit = permissions.can("update", "sales");
  const canDelete = permissions.can("delete", "sales");

  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: SalesOrderLine) => {
      if (!supabase) throw new Error("Supabase client not found");
      return await supabase
        .from("salesOrderLine")
        .update({
          [id]: value,
          updatedBy: userId,
        })
        .eq("id", row.id!);
    },
    [supabase, userId]
  );

  return {
    canDelete,
    canEdit,
    supabase,
    onCellEdit,
  };
}
