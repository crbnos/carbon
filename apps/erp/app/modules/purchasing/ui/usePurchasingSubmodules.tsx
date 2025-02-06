import {
  LuContainer,
  LuCreditCard,
  LuLayoutList,
  LuPackageSearch,
  LuShapes,
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
        internal: true,
        table: "supplierQuote",
      },
      {
        name: "Orders",
        to: path.to.purchaseOrders,
        icon: <LuLayoutList />,
        internal: true,
        table: "purchaseOrder",
      },
      {
        name: "Invoices",
        to: path.to.purchaseInvoices,
        icon: <LuCreditCard />,
        internal: true,
        table: "purchaseInvoice",
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
      // {
      //   name: "Types",
      //   to: path.to.supplierTypes,
      //   role: "employee",
      //   icon: <LuStar />,
      // },
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
