import { useNavigate } from "@remix-run/react";
import { useCallback } from "react";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { InventoryItem } from "../../types";

export const useInventoryItem = () => {
  const navigate = useNavigate();
  const [params] = useUrlParams();

  const view = useCallback(
    (inventoryItem: InventoryItem) => {
      navigate(
        `${path.to.inventoryItemView(inventoryItem.itemId!)}/?${params}`
      );
    },
    [navigate, params]
  );

  return {
    view,
  };
};
