import { LuBan, LuSquareUser, LuStar } from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line,
} from "react-icons/ri";
import { usePermissions } from "~/hooks";
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
      },
      {
        name: "RFQs",
        to: path.to.salesRfqs,
        icon: <RiProgress2Line />,
      },
      {
        name: "Quotes",
        to: path.to.quotes,
        icon: <RiProgress4Line />,
      },
      {
        name: "Orders",
        to: path.to.salesOrders,
        icon: <RiProgress8Line />,
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Statuses",
        to: path.to.customerStatuses,
        role: "employee",
        icon: <LuStar />,
      },
      {
        name: "No Quote Reasons",
        to: path.to.noQuoteReasons,
        role: "employee",
        icon: <LuBan />,
      },
      // {
      //   name: "Types",
      //   to: path.to.customerTypes,
      //   role: "employee",
      //   icon: <LuShapes />,
      // },
    ],
  },
];

export default function useSalesSubmodules() {
  const permissions = usePermissions();
  // to modify
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
        routes: group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
          } else {
            return true;
          }
        }),
      })),
  };
}
