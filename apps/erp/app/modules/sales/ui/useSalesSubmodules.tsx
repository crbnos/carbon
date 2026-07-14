import { useLingui } from "@lingui/react/macro";
import {
  LuBan,
  LuGlobe,
  LuList,
  LuPercent,
  LuShapes,
  LuSquareUser,
  LuStar
} from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useSalesSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();
  const salesRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Manage`,
      routes: [
        {
          name: t`Customers`,
          to: path.to.customers,
          icon: <LuSquareUser />,
          table: "customer"
        },
        {
          name: t`RFQs`,
          to: path.to.salesRfqs,
          icon: <RiProgress2Line />,
          table: "salesRfq"
        },
        {
          name: t`Quotes`,
          to: path.to.quotes,
          icon: <RiProgress4Line />,
          table: "quote"
        },
        {
          name: t`Orders`,
          to: path.to.salesOrders,
          icon: <RiProgress8Line />,
          table: "salesOrder"
        },
        {
          name: t`Portals`,
          to: path.to.customerPortals,
          role: "employee",
          icon: <LuGlobe />
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Price Lists`,
          to: path.to.salesPriceList,
          role: "employee",
          icon: <LuList />
        },
        {
          name: t`Pricing Rules`,
          to: path.to.salesPricingRules,
          role: "employee",
          icon: <LuPercent />
        },
        {
          name: t`No Quote Reasons`,
          to: path.to.noQuoteReasons,
          role: "employee",
          icon: <LuBan />
        },

        {
          name: t`Statuses`,
          to: path.to.customerStatuses,
          role: "employee",
          icon: <LuStar />
        },
        {
          name: t`Types`,
          to: path.to.customerTypes,
          role: "employee",
          icon: <LuShapes />
        }
      ]
    }
  ];

  return {
    groups: salesRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
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
