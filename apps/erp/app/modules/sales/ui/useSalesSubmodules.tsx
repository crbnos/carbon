import {
  LuBan,
  LuCreditCard,
  LuGlobe,
  LuShapes,
  LuSquareUser,
  LuStar,
} from "react-icons/lu";
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
      {
        name: "Invoices",
        to: path.to.salesInvoices,
        icon: <LuCreditCard />,
        permission: "invoicing",
        table: "salesInvoice",
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "No Quotes",
        to: path.to.noQuoteReasons,
        role: "employee",
        icon: <LuBan />,
      },
      {
        name: "Portals",
        to: path.to.customerPortals,
        role: "employee",
        icon: <LuGlobe />,
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
            } else if (route.permission) {
              return permissions.can("view", route.permission);
            } else {
              return true;
            }
          })
          .map(addSavedViewsToRoutes),
      })),
  };
}
