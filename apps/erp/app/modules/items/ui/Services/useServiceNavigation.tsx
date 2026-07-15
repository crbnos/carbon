import { useLingui } from "@lingui/react/macro";
import {
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
import type { ServiceSummary } from "../../types";

export function useServiceNavigation() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{
    serviceSummary: ServiceSummary;
  }>(path.to.service(itemId));
  if (!routeData?.serviceSummary?.replenishmentSystem)
    throw new Error("Could not find replenishmentSystem in routeData");

  const replenishment = routeData.serviceSummary.replenishmentSystem;

  return [
    {
      name: t`Details`,
      to: path.to.serviceDetails(itemId),
      icon: LuFileText,
      shortcut: "Command+Shift+d"
    },
    {
      name: t`Purchasing`,
      to: path.to.servicePurchasing(itemId),
      isDisabled: replenishment === "Make",
      role: ["employee", "supplier"],
      permission: "purchasing",
      icon: LuShoppingCart,
      shortcut: "Command+Shift+p"
    },
    {
      name: t`Sales`,
      to: path.to.serviceSales(itemId),
      role: ["employee", "customer"],
      icon: LuReceipt,
      shortcut: "Command+Shift+x"
    },
    {
      name: t`Accounting`,
      to: path.to.serviceCosting(itemId),
      role: ["employee"],
      permission: "purchasing",
      icon: LuTags,
      shortcut: "Command+Shift+a"
    },
    {
      name: t`Quality`,
      to: path.to.serviceQuality(itemId),
      isDisabled: !routeData?.serviceSummary?.requiresInspection,
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
