// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { DETAIL_TAB_SHORTCUTS } from "~/shortcuts";
import { visibleRoutes } from "~/utils/nav";
import { path } from "~/utils/path";
import type { ToolSummary } from "../../types";
import { ITEM_TAB_GATES } from "../itemTabGates";

export function useToolNavigation() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{
    toolSummary: ToolSummary;
  }>(path.to.tool(itemId));
  if (!routeData?.toolSummary?.replenishmentSystem)
    throw new Error("Could not find replenishmentSystem in routeData");
  if (!routeData?.toolSummary?.itemTrackingType)
    throw new Error("Could not find itemTrackingType in routeData");

  const replenishment = routeData.toolSummary.replenishmentSystem;
  const itemTrackingType = routeData.toolSummary.itemTrackingType;

  const tabs = [
    {
      name: t`Details`,
      to: path.to.toolDetails(itemId),
      icon: LuFileText,
      shortcut: DETAIL_TAB_SHORTCUTS.details
    },
    {
      name: t`Purchasing`,
      to: path.to.toolPurchasing(itemId),
      isDisabled: replenishment === "Make",
      gate: ITEM_TAB_GATES.purchasing,
      icon: LuShoppingCart,
      shortcut: DETAIL_TAB_SHORTCUTS.purchasing
    },
    {
      name: t`Accounting`,
      to: path.to.toolCosting(itemId),
      gate: ITEM_TAB_GATES.accounting,
      icon: LuTags,
      shortcut: DETAIL_TAB_SHORTCUTS.accounting
    },
    {
      name: t`Planning`,
      to: path.to.toolPlanning(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      icon: LuChartLine,
      shortcut: DETAIL_TAB_SHORTCUTS.planning
    },
    {
      name: t`Inventory`,
      to: path.to.toolInventory(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      icon: LuBox,
      shortcut: DETAIL_TAB_SHORTCUTS.inventory
    },
    {
      name: t`Sales`,
      to: path.to.toolSales(itemId),
      icon: LuReceipt,
      shortcut: DETAIL_TAB_SHORTCUTS.sales
    },
    {
      name: t`Quality`,
      to: path.to.toolQuality(itemId),
      gate: ITEM_TAB_GATES.quality,
      icon: LuClipboardCheck,
      shortcut: DETAIL_TAB_SHORTCUTS.quality
    }
  ];
  return visibleRoutes(tabs, permissions, (tab) => !tab.isDisabled);
}
