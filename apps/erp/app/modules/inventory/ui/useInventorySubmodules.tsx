import { LuBox, LuGroup, LuHandCoins, LuTruck } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
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
        icon: <LuBox />,
        table: "inventory",
        // groups: [
        //   {
        //     name: "Parts",
        //     to: `${path.to.inventory}?filter=${encodeURIComponent(
        //       "type:eq:Part"
        //     )}`,
        //   },
        //   {
        //     name: "Materials",
        //     to: `${path.to.inventory}?filter=${encodeURIComponent(
        //       "type:eq:Material"
        //     )}`,
        //   },
        //   {
        //     name: "Tools",
        //     to: `${path.to.inventory}?filter=${encodeURIComponent(
        //       "type:eq:Tool"
        //     )}`,
        //   },
        //   {
        //     name: "Consumables",
        //     to: `${path.to.inventory}?filter=${encodeURIComponent(
        //       "type:eq:Consumable"
        //     )}`,
        //   },
        // ],
      },
      {
        name: "Receipts",
        to: path.to.receipts,
        icon: <LuHandCoins />,
        table: "receipt",
      },
      {
        name: "Batches",
        to: path.to.batches,
        icon: <LuGroup />,
        table: "batchNumber",
      },
      // {
      //   name: "Shipments",
      //   to: path.to.shipments,
      // },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Shipping",
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
