import { LuHandCoins, LuNetwork, LuTally5, LuTruck } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const inventoryRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Traceability",
    routes: [
      {
        name: "Quantities",
        to: path.to.inventory,
        role: "employee",
        icon: <LuTally5 />,
        table: "inventory",
      },
      {
        name: "Traceability",
        to: path.to.traceability,
        role: "employee",
        icon: <LuNetwork />,
      },
    ],
  },
  {
    name: "Manage",
    routes: [
      {
        name: "Receipts",
        to: path.to.receipts,
        icon: <LuHandCoins />,
        table: "receipt",
      },
      {
        name: "Shipments",
        to: path.to.shipments,
        icon: <LuTruck />,
        table: "shipment",
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Shipping Methods",
        to: path.to.shippingMethods,
        role: "employee",
        icon: <LuTruck />,
      },
    ],
  },
];

export default function useAccountingSubmodules() {
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

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
