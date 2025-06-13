import { useParams } from "@remix-run/react";

import {
  LuBox,
  LuChartLine,
  LuFileText,
  LuShoppingCart,
  LuTags,
} from "react-icons/lu";
import { usePermissions, useRouteData } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";
import type { MaterialSummary } from "../../types";

export function useMaterialNavigation() {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ materialSummary: MaterialSummary }>(
    path.to.material(itemId)
  );
  if (!routeData?.materialSummary?.itemTrackingType)
    throw new Error("Could not find itemTrackingType in routeData");

  const itemTrackingType = routeData.materialSummary.itemTrackingType;

  return [
    {
      name: "Details",
      to: path.to.materialDetails(itemId),
      icon: LuFileText,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Purchasing",
      to: path.to.materialPurchasing(itemId),
      role: ["employee", "supplier"],
      permission: "purchasing",
      icon: LuShoppingCart,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Costing",
      to: path.to.materialCosting(itemId),
      role: ["employee"],
      permission: "purchasing",
      icon: LuTags,
      shortcut: "Command+Shift+c",
    },
    {
      name: "Planning",
      to: path.to.materialPlanning(itemId),
      role: ["employee"],
      icon: LuChartLine,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Inventory",
      to: path.to.materialInventory(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      role: ["employee", "supplier"],
      icon: LuBox,
      shortcut: "Command+Shift+i",
    },
  ].filter(
    (item) =>
      !item.isDisabled &&
      (item.role === undefined ||
        item.role.some((role) => permissions.is(role as Role))) &&
      (item.permission === undefined ||
        permissions.can("view", item.permission))
  );
}
