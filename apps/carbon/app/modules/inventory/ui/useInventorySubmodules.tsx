import { usePermissions } from "~/hooks";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const inventoryRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Inventory",
        to: path.to.inventory,
        role: "employee",
      },
      // {
      //   name: "Receipts",
      //   to: path.to.receipts,
      // },
      // {
      //   name: "Shipments",
      //   to: path.to.shipments,
      // },
    ],
  },
  // {
  //   name: "Configure",
  //   routes: [
  //     {
  //       name: "Shipping Methods",
  //       to: path.to.shippingMethods,
  //       role: "employee",
  //     },
  //   ],
  // },
];

export default function useAccountingSubmodules() {
  const permissions = usePermissions();
  return {
    groups: inventoryRoutes
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
