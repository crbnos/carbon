// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuBox,
  LuChartLine,
  LuClipboardCheck,
  LuFileText,
  LuListTree,
  LuReceipt,
  LuShoppingCart,
  LuTags,
  LuWorkflow
} from "react-icons/lu";
import { useLocation, useParams } from "react-router";
import { usePermissions, useRouteData } from "~/hooks";
import { DETAIL_TAB_SHORTCUTS } from "~/shortcuts";
import type { Role } from "~/types";
import { path } from "~/utils/path";
import type { PartSummary } from "../../types";
import { getMethodSearch } from "../Item/methodPageUtils";

export function usePartNavigation() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { itemId } = useParams();
  const location = useLocation();
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
  // These tabs show the same method, so moving between them keeps its version.
  const methodSearch = getMethodSearch(location.search);
  const details = path.to.partDetails(itemId);
  const billOfMaterial = path.to.partBillOfMaterial(itemId);
  const billOfProcess = path.to.partBillOfProcess(itemId);

  return [
    {
      name: t`Details`,
      to: `${details}${methodSearch}`,
      icon: LuFileText,
      shortcut: DETAIL_TAB_SHORTCUTS.details,
      isActive: (pathname: string) => pathname.includes(details)
    },
    {
      name: t`Bill of Material`,
      to: `${billOfMaterial}${methodSearch}`,
      isDisabled: replenishment === "Buy",
      role: ["employee"],
      icon: LuListTree,
      isActive: (pathname: string) => pathname.includes(billOfMaterial)
    },
    {
      name: t`Bill of Process`,
      to: `${billOfProcess}${methodSearch}`,
      isDisabled: replenishment === "Buy",
      role: ["employee"],
      icon: LuWorkflow,
      isActive: (pathname: string) => pathname.includes(billOfProcess)
    },
    {
      name: t`Purchasing`,
      to: path.to.partPurchasing(itemId),
      isDisabled: replenishment === "Make",
      role: ["employee", "supplier"],
      permission: "purchasing",
      icon: LuShoppingCart,
      shortcut: DETAIL_TAB_SHORTCUTS.purchasing
    },
    {
      name: t`Accounting`,
      to: path.to.partCosting(itemId),
      role: ["employee"],
      permission: "purchasing",
      icon: LuTags,
      shortcut: DETAIL_TAB_SHORTCUTS.accounting
    },
    {
      name: t`Planning`,
      to: path.to.partPlanning(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      role: ["employee"],
      icon: LuChartLine,
      shortcut: DETAIL_TAB_SHORTCUTS.planning
    },
    {
      name: t`Inventory`,
      to: path.to.partInventory(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      role: ["employee", "supplier"],
      icon: LuBox,
      shortcut: DETAIL_TAB_SHORTCUTS.inventory
    },
    {
      name: t`Sales`,
      to: path.to.partSales(itemId),
      role: ["employee", "customer"],
      icon: LuReceipt,
      shortcut: DETAIL_TAB_SHORTCUTS.sales
    },
    {
      name: t`Quality`,
      to: path.to.partQuality(itemId),
      role: ["employee"],
      permission: "quality",
      icon: LuClipboardCheck,
      shortcut: DETAIL_TAB_SHORTCUTS.quality
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
