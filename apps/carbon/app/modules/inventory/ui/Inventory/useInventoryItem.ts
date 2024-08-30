import { useNavigate } from "@remix-run/react";
import { useCallback } from "react";
import { usePermissions, useUrlParams, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import { path } from "~/utils/path";
import type { InventoryItem } from "../../types";

export const useInventoryItem = () => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { supabase } = useSupabase();
  const [params, setParams] = useUrlParams();
  const user = useUser();

  const canDelete = useCallback(
    (inventoryItem: InventoryItem) => {
      return !permissions.can("delete", "inventory");
    },
    [permissions, user]
  );

  const canUpdate = useCallback(
    (inventoryItem: InventoryItem) => {
      return !permissions.can("update", "inventory");
    },
    [permissions, user]
  );

  // const insertTransaction = useCallback(
  //   (document: DocumentType, type: DocumentTransactionType) => {
  //     if (user?.id === undefined) throw new Error("User is undefined");
  //     if (!document.id) throw new Error("Document id is undefined");

  //     return supabase?.from("documentTransaction").insert({
  //       documentId: document.id,
  //       type,
  //       userId: user.id,
  //     });
  //   },
  //   [supabase, user?.id]
  // );

  const view = useCallback(
    (inventoryItem: InventoryItem) => {
      navigate(`${path.to.inventoryItemView(inventoryItem.id!)}/?${params}`);
    },
    [navigate, params]
  );

  const edit = useCallback(
    (inventoryItem: InventoryItem) =>
      navigate(`${path.to.document(inventoryItem.id!)}?${params}`),
    [navigate, params]
  );

  return {
    canDelete,
    canUpdate,
    edit,
    view,
  };
};
