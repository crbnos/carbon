import { useParams } from "@remix-run/react";

import { LuBox, LuFileText, LuShoppingCart, LuTags } from "react-icons/lu";
import { usePermissions, useRouteData } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";
import type { ToolSummary } from "../../types";

export function useToolNavigation() {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ toolSummary: ToolSummary }>(
    path.to.tool(itemId)
  );
  if (!routeData?.toolSummary?.itemTrackingType)
    throw new Error("Could not find itemTrackingType in routeData");

  const itemTrackingType = routeData.toolSummary.itemTrackingType;

  return [
    {
      name: "Details",
      to: path.to.toolDetails(itemId),
      icon: LuFileText,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Purchasing",
      to: path.to.toolPurchasing(itemId),
      role: ["employee", "supplier"],
      icon: LuShoppingCart,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Costing",
      to: path.to.toolCosting(itemId),
      role: ["employee"],
      icon: LuTags,
      shortcut: "Command+Shift+c",
    },
    // {
    //   name: "Planning",
    //   to: path.to.toolPlanning(itemId),
    //   role: ["employee"],
    //   icon: LuFileBarChart,
    //   shortcut: "Command+Shift+p",
    // },
    {
      name: "Inventory",
      to: path.to.toolInventory(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      role: ["employee", "supplier"],
      icon: LuBox,
      shortcut: "Command+Shift+i",
    },
  ].filter(
    (item) =>
      !item.isDisabled &&
      (item.role === undefined ||
        item.role.some((role) => permissions.is(role as Role)))
  );
}
