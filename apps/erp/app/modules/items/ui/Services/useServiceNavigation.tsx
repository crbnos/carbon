// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { DETAIL_TAB_SHORTCUTS } from "~/shortcuts";
import { visibleRoutes } from "~/utils/nav";
import { path } from "~/utils/path";
import type { ServiceSummary } from "../../types";
import { ITEM_TAB_GATES } from "../itemTabGates";

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

  const tabs = [
    {
      name: t`Details`,
      to: path.to.serviceDetails(itemId),
      icon: LuFileText,
      shortcut: DETAIL_TAB_SHORTCUTS.details
    },
    {
      name: t`Purchasing`,
      to: path.to.servicePurchasing(itemId),
      isDisabled: replenishment === "Make",
      gate: ITEM_TAB_GATES.purchasing,
      icon: LuShoppingCart,
      shortcut: DETAIL_TAB_SHORTCUTS.purchasing
    },
    {
      name: t`Sales`,
      to: path.to.serviceSales(itemId),
      icon: LuReceipt,
      shortcut: DETAIL_TAB_SHORTCUTS.sales
    },
    {
      name: t`Accounting`,
      to: path.to.serviceCosting(itemId),
      gate: ITEM_TAB_GATES.accounting,
      icon: LuTags,
      shortcut: DETAIL_TAB_SHORTCUTS.accounting
    },
    {
      name: t`Quality`,
      to: path.to.serviceQuality(itemId),
      gate: ITEM_TAB_GATES.quality,
      icon: LuClipboardCheck,
      shortcut: DETAIL_TAB_SHORTCUTS.quality
    }
  ];
  return visibleRoutes(tabs, permissions, (tab) => !tab.isDisabled);
}
