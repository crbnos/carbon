import { useLingui } from "@lingui/react/macro";
import {
  LuBox,
  LuChartLine,
  LuClipboardCheck,
  LuFileText,
  LuShoppingCart,
  LuTags
} from "react-icons/lu";
import { useParams } from "react-router";
import { usePermissions, useRouteData } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";
import type { ConsumableSummary } from "../../types";

export function useConsumableNavigation() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ consumableSummary: ConsumableSummary }>(
    path.to.consumable(itemId)
  );
  if (!routeData?.consumableSummary?.itemTrackingType)
    throw new Error("Could not find itemTrackingType in routeData");

  const itemTrackingType = routeData.consumableSummary.itemTrackingType;

  return [
    {
      name: t`Details`,
      to: path.to.consumableDetails(itemId),
      icon: LuFileText,
      shortcut: "Command+Shift+d"
    },
    {
      name: t`Purchasing`,
      to: path.to.consumablePurchasing(itemId),
      role: ["employee", "supplier"],
      permission: "purchasing",
      icon: LuShoppingCart,
      shortcut: "Command+Shift+p"
    },
    {
      name: t`Accounting`,
      to: path.to.consumableCosting(itemId),
      role: ["employee"],
      permission: "purchasing",
      icon: LuTags,
      shortcut: "Command+Shift+a"
    },
    {
      name: t`Planning`,
      to: path.to.consumablePlanning(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      role: ["employee"],
      icon: LuChartLine,
      shortcut: "Command+Shift+p"
    },
    {
      name: t`Inventory`,
      to: path.to.consumableInventory(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      role: ["employee", "supplier"],
      icon: LuBox,
      shortcut: "Command+Shift+i"
    },
    {
      name: t`Quality`,
      to: path.to.consumableQuality(itemId),
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
