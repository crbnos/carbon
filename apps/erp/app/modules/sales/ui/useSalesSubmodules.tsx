import { LuBan, LuShapes, LuSquareUser, LuStar } from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line,
} from "react-icons/ri";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const salesRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Customers",
        to: path.to.customers,
        icon: <LuSquareUser />,
        table: "customer",
      },
      {
        name: "RFQs",
        to: path.to.salesRfqs,
        icon: <RiProgress2Line />,
        table: "salesRfq",
      },
      {
        name: "Quotes",
        to: path.to.quotes,
        icon: <RiProgress4Line />,
        table: "quote",
      },
      {
        name: "Orders",
        to: path.to.salesOrders,
        icon: <RiProgress8Line />,
        table: "salesOrder",
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "No Quote Reasons",
        to: path.to.noQuoteReasons,
        role: "employee",
        icon: <LuBan />,
      },
      {
        name: "Statuses",
        to: path.to.customerStatuses,
        role: "employee",
        icon: <LuStar />,
      },
      {
        name: "Types",
        to: path.to.customerTypes,
        role: "employee",
        icon: <LuShapes />,
      },
    ],
  },
];

export default function useSalesSubmodules() {
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

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
            } else {
              return true;
            }
          })
          .map(addSavedViewsToRoutes),
      })),
  };
}
