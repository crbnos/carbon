// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuContainer,
  LuFileText,
  LuKeyRound,
  LuLayoutList,
  LuListTodo,
  LuPackageSearch,
  LuStar,
  LuUndo2
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { visibleGroups } from "~/utils/nav";
import { path } from "~/utils/path";

export default function usePurchasingSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  const purchasingRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Suppliers`,
      routes: [
        {
          name: t`Suppliers`,
          to: path.to.suppliers,
          icon: <LuContainer />,
          table: "supplier"
        }
      ]
    },
    {
      name: t`Orders`,
      routes: [
        {
          name: t`Purchase Orders`,
          to: path.to.purchaseOrders,
          icon: <LuLayoutList />,
          table: "purchaseOrder"
        },
        {
          name: t`Returns`,
          to: path.to.purchaseReturnOrders,
          icon: <LuUndo2 />,
          table: "purchaseReturnOrder"
        }
      ]
    },
    {
      name: t`Planning`,
      routes: [
        {
          name: t`Material Planning`,
          to: path.to.purchasingPlanning,
          icon: <LuListTodo />,
          table: "planning"
        }
      ]
    },
    {
      name: t`Agreements`,
      routes: [
        {
          name: t`Leases`,
          to: path.to.leases,
          icon: <LuKeyRound />,
          table: "lease"
        }
      ]
    },
    {
      name: t`Sourcing`,
      routes: [
        {
          name: t`RFQs`,
          to: path.to.purchasingRfqs,
          icon: <LuPackageSearch />,
          table: "purchasingRfq"
        },
        {
          name: t`Supplier Quotes`,
          to: path.to.supplierQuotes,
          icon: <LuFileText />,
          table: "supplierQuote"
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Types`,
          to: path.to.supplierTypes,
          icon: <LuStar />
        }
      ]
    }
  ];

  return {
    groups: visibleGroups(purchasingRoutes, permissions).map((group) => ({
      ...group,
      routes: group.routes.map(addSavedViewsToRoutes)
    }))
  };
}
