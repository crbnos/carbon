import { useLingui } from "@lingui/react/macro";
import {
  LuBox,
  LuChartLine,
  LuClipboardCheck,
  LuFileText,
  LuReceipt,
  LuShoppingCart,
  LuTags
} from "react-icons/lu";
import { useParams } from "react-router";
import { usePermissions, useRouteData } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";
import type { PartSummary } from "../../types";

export function usePartNavigation() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );
  if (!routeData?.partSummary?.replenishmentSystem)
    throw new Error("Could not find replenishmentSystem in routeData");
  if (!routeData?.partSummary?.itemTrackingType)
    throw new Error("Could not find itemTrackingType in routeData");

  const replenishment = routeData.partSummary.replenishmentSystem;
  const itemTrackingType = routeData.partSummary.itemTrackingType;

  return [
    {
      name: t`Details`,
      to: path.to.partDetails(itemId),
      icon: LuFileText,
      shortcut: "Command+Shift+d"
    },
    {
      name: t`Purchasing`,
      to: path.to.partPurchasing(itemId),
      isDisabled: replenishment === "Make",
      role: ["employee", "supplier"],
      permission: "purchasing",
      icon: LuShoppingCart,
      shortcut: "Command+Shift+p"
    },
    {
      name: t`Accounting`,
      to: path.to.partCosting(itemId),
      role: ["employee"],
      permission: "purchasing",
      icon: LuTags,
      shortcut: "Command+Shift+a"
    },
    {
      name: t`Planning`,
      to: path.to.partPlanning(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      role: ["employee"],
      icon: LuChartLine,
      shortcut: "Command+Shift+p"
    },
    {
      name: t`Inventory`,
      to: path.to.partInventory(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      role: ["employee", "supplier"],
      icon: LuBox,
      shortcut: "Command+Shift+i"
    },
    {
      name: t`Sales`,
      to: path.to.partSales(itemId),
      role: ["employee", "customer"],
      icon: LuReceipt,
      shortcut: "Command+Shift+x"
    },
    {
      name: t`Quality`,
      to: path.to.partQuality(itemId),
      role: ["employee"],
      permission: "quality",
      icon: LuClipboardCheck,
      shortcut: "Command+Shift+q"
    }
  ].filter(
    (item) =>
      !item.isDisabled &&
      (item.role === undefined ||
        item.role.some((role) => permissions.is(role as Role))) &&
      (item.permission === undefined ||
        permissions.can("view", item.permission))
  );
}
