import { useLingui } from "@lingui/react/macro";
import {
  LuContainer,
  LuFileText,
  LuLayoutList,
  LuPackageSearch,
  LuSquareChartGantt,
  LuStar
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
      name: t`Manage`,
      routes: [
        {
          name: t`Suppliers`,
          to: path.to.suppliers,
          icon: <LuContainer />,
          table: "supplier"
        },
        {
          name: t`RFQs`,
          to: path.to.purchasingRfqs,
          icon: <LuPackageSearch />,
          table: "purchasingRfq"
        },
        {
          name: t`Quotes`,
          to: path.to.supplierQuotes,
          icon: <LuFileText />,
          table: "supplierQuote"
        },
        {
          name: t`Orders`,
          to: path.to.purchaseOrders,
          icon: <LuLayoutList />,
          table: "purchaseOrder"
        }
      ]
    },
    {
      name: t`Plan`,
      routes: [
        {
          name: t`Planning`,
          to: path.to.purchasingPlanning,
          icon: <LuSquareChartGantt />,
          table: "purchase-planning"
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Types`,
          to: path.to.supplierTypes,
          role: "employee",
          icon: <LuStar />
        }
      ]
    }
  ];

  return {
    groups: purchasingRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
          } else if (route.permission) {
            return permissions.can("view", route.permission);
          } else {
            return true;
          }
        });

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes
          .filter((route) => {
            if (route.role) {
              return permissions.is(route.role);
            } else if (route.permission) {
              return permissions.can("view", route.permission);
            } else {
              return true;
            }
          })
          .map(addSavedViewsToRoutes)
      }))
  };
}
