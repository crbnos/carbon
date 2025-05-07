import {
  LuContainer,
  LuCreditCard,
  LuLayoutList,
  LuPackageSearch,
  LuShapes,
  LuStar,
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const purchasingRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Suppliers",
        to: path.to.suppliers,
        icon: <LuContainer />,
        table: "supplier",
      },
      {
        name: "Quotes",
        to: path.to.supplierQuotes,
        icon: <LuPackageSearch />,
        table: "supplierQuote",
      },
      {
        name: "Orders",
        to: path.to.purchaseOrders,
        icon: <LuLayoutList />,
        table: "purchaseOrder",
      },
      {
        name: "Invoices",
        to: path.to.purchaseInvoices,
        icon: <LuCreditCard />,
        table: "purchaseInvoice",
        permission: "invoicing",
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Statuses",
        to: path.to.supplierStatuses,
        role: "employee",
        icon: <LuShapes />,
      },
      {
        name: "Types",
        to: path.to.supplierTypes,
        role: "employee",
        icon: <LuStar />,
      },
    ],
  },
];

export default function usePurchasingSubmodules() {
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

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
          .map(addSavedViewsToRoutes),
      })),
  };
}
