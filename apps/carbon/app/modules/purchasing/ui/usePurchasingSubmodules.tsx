import { usePermissions } from "~/hooks";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const purchasingRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Purchase Orders",
        to: path.to.purchaseOrders,
      },
      {
        name: "Suppliers",
        to: path.to.suppliers,
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Supplier Statuses",
        to: path.to.supplierStatuses,
        role: "employee",
      },
      {
        name: "Supplier Types",
        to: path.to.supplierTypes,
        role: "employee",
      },
    ],
  },
];

export default function usePurchasingSubmodules() {
  const permissions = usePermissions();
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
