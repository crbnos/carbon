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
          page: "purchasing.suppliers",
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
          page: "purchasing.purchaseOrders",
          icon: <LuLayoutList />,
          table: "purchaseOrder"
        },
        {
          name: t`Returns`,
          to: path.to.purchaseReturnOrders,
          page: "purchasing.returns",
          icon: <LuUndo2 />,
          table: "purchaseReturnOrder"
        }
      ]
    },
    {
      name: t`Agreements`,
      routes: [
        {
          name: t`Leases`,
          to: path.to.leases,
          page: "purchasing.leases",
          icon: <LuKeyRound />,
          table: "lease"
        }
      ]
    },
    {
      name: t`Planning`,
      routes: [
        {
          name: t`Material Planning`,
          to: path.to.purchasingPlanning,
          page: "purchasing.materialPlanning",
          icon: <LuListTodo />,
          table: "planning"
        }
      ]
    },
    {
      name: t`Sourcing`,
      routes: [
        {
          name: t`RFQs`,
          to: path.to.purchasingRfqs,
          page: "purchasing.rfqs",
          icon: <LuPackageSearch />,
          table: "purchasingRfq"
        },
        {
          name: t`Supplier Quotes`,
          to: path.to.supplierQuotes,
          page: "purchasing.supplierQuotes",
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
          page: "purchasing.types",
          role: "employee",
          icon: <LuStar />
        }
      ]
    }
  ];

  const isRouteVisible = (route: AuthenticatedRouteGroup["routes"][number]) =>
    (!route.role || permissions.is(route.role)) &&
    (!route.page || permissions.has({ [route.page]: "View" }));

  return {
    groups: purchasingRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          return isRouteVisible(route);
        });

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes
          .filter((route) => {
            return isRouteVisible(route);
          })
          .map(addSavedViewsToRoutes)
      }))
  };
}
