// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuBan,
  LuGlobe,
  LuKeyRound,
  LuList,
  LuPercent,
  LuSection,
  LuShapes,
  LuShieldCheck,
  LuSquareUser,
  LuStar,
  LuUndo2
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
      name: t`Customers`,
      routes: [
        {
          name: t`Customers`,
          to: path.to.customers,
          page: "sales.customers",
          icon: <LuSquareUser />,
          table: "customer"
        },
        {
          name: t`Portals`,
          to: path.to.customerPortals,
          page: "sales.portals",
          role: "employee",
          icon: <LuGlobe />
        }
      ]
    },
    {
      name: t`Quoting`,
      routes: [
        {
          name: t`RFQs`,
          to: path.to.salesRfqs,
          page: "sales.rfqs",
          icon: <RiProgress2Line />,
          table: "salesRfq"
        },
        {
          name: t`Quotes`,
          to: path.to.quotes,
          page: "sales.quotes",
          icon: <RiProgress4Line />,
          table: "quote"
        }
      ]
    },
    {
      name: t`Orders`,
      routes: [
        {
          name: t`Sales Orders`,
          to: path.to.salesOrders,
          page: "sales.salesOrders",
          icon: <RiProgress8Line />,
          table: "salesOrder"
        },
        {
          name: t`Returns`,
          to: path.to.salesReturnOrders,
          page: "sales.returns",
          icon: <LuUndo2 />,
          table: "salesReturnOrder"
        }
      ]
    },
    {
      name: t`Agreements`,
      routes: [
        {
          name: t`Service Contracts`,
          to: path.to.contracts,
          page: "sales.serviceContracts",
          icon: <LuSection />,
          table: "customerContract"
        },
        {
          name: t`Rental Agreements`,
          to: path.to.rentalAgreements,
          page: "sales.rentalAgreements",
          icon: <LuKeyRound />,
          table: "rentalAgreement"
        }
      ]
    },
    {
      name: t`Pricing`,
      routes: [
        {
          name: t`Price Lists`,
          to: path.to.salesPriceList,
          page: "sales.priceLists",
          role: "employee",
          icon: <LuList />
        },
        {
          name: t`Pricing Rules`,
          to: path.to.salesPricingRules,
          page: "sales.pricingRules",
          role: "employee",
          icon: <LuPercent />
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Sales Rules`,
          to: path.to.salesRules,
          page: "sales.salesRules",
          role: "employee",
          icon: <LuShieldCheck />
        },
        {
          name: t`No Quote Reasons`,
          to: path.to.noQuoteReasons,
          page: "sales.noQuoteReasons",
          role: "employee",
          icon: <LuBan />
        },
        {
          name: t`Return Reasons`,
          to: path.to.returnReasons,
          page: "sales.returnReasons",
          role: "employee",
          icon: <LuUndo2 />
        },
        {
          name: t`Statuses`,
          to: path.to.customerStatuses,
          page: "sales.statuses",
          role: "employee",
          icon: <LuStar />
        },
        {
          name: t`Types`,
          to: path.to.customerTypes,
          page: "sales.types",
          role: "employee",
          icon: <LuShapes />
        }
      ]
    }
  ];

  const isRouteVisible = (route: AuthenticatedRouteGroup["routes"][number]) =>
    (!route.role || permissions.is(route.role)) &&
    (!route.page || permissions.has({ [route.page]: "View" }));

  return {
    groups: salesRoutes
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
