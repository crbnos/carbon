import { useParams } from "@remix-run/react";

import { LuChartBar, LuFileText } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

export function useInventoryNavigation() {
  usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  return [
    {
      name: "Details",
      to: path.to.inventoryItem(itemId),
      role: ["employee"],
      icon: LuFileText,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Activity",
      to: path.to.inventoryItemActivity(itemId),
      role: ["employee"],
      icon: LuChartBar,
      shortcut: "Command+Shift+a",
    },
  ];
}
