import { useCallback } from "react";
import { usePermissions } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { BuyMethod } from "~/modules/items";

export default function useBuyMethods() {
  const { supabase } = useSupabase();
  const permissions = usePermissions();

  const canEdit = permissions.can("update", "parts");
  const canDelete = permissions.can("delete", "parts");

  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: BuyMethod) => {
      if (!supabase) throw new Error("Supabase client not found");
      return await supabase
        .from("buyMethod")
        .update({
          [id]: value,
        })
        .eq("id", row.id);
    },
    [supabase]
  );

  return {
    canDelete,
    canEdit,
    supabase,
    onCellEdit,
  };
}
