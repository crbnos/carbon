import {
  LuArrowRightLeft,
  LuFolderKanban,
  LuHandCoins,
  LuNetwork,
  LuQrCode,
  LuTally5,
  LuTruck,
  LuWarehouse,
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const inventoryRoutes: AuthenticatedRouteGroup[] = [
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
      {
        name: "Transfers",
        to: path.to.warehouseTransfers,
        icon: <LuArrowRightLeft />,
        table: "warehouseTransfer",
      },
    ],
  },
  {
    name: "Track",
    routes: [
      {
        name: "Quantities",
        to: path.to.inventory,
        role: "employee",
        icon: <LuTally5 />,
        table: "inventory",
      },
      {
        name: "Tracked Entities",
        to: path.to.trackedEntities,
        role: "employee",
        icon: <LuQrCode />,
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
    name: "Configure",
    routes: [
      {
        name: "Kanbans",
        to: path.to.kanbans,
        role: "employee",
        icon: <LuFolderKanban />,
      },
      {
        name: "Shelves",
        to: path.to.shelves,
        role: "employee",
        icon: <LuWarehouse />,
        table: "shelf",
      },
      {
        name: "Shipping Methods",
        to: path.to.shippingMethods,
        role: "employee",
        icon: <LuTruck />,
      },
    ],
  },
];

export default function useInventorySubmodules() {
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
