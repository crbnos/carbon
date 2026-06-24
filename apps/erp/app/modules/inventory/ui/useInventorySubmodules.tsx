import { useLingui } from "@lingui/react/macro";
import {
  LuArrowDownUp,
  LuArrowRightLeft,
  LuClipboardList,
  LuHandCoins,
  LuListChecks,
  LuNetwork,
  LuQrCode,
  LuScanQrCode,
  LuShieldCheck,
  LuTag,
  LuTally5,
  LuTruck,
  LuWarehouse
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useInventorySubmodules() {
  const permissions = usePermissions();
  const { t } = useLingui();
  const { addSavedViewsToRoutes } = useSavedViews();

  const inventoryRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Manage`,
      routes: [
        {
          name: t`Picking Lists`,
          to: path.to.pickingLists,
          icon: <LuClipboardList />
        },
        {
          name: t`Receipts`,
          to: path.to.receipts,
          icon: <LuHandCoins />,
          table: "receipt"
        },
        {
          name: t`Shipments`,
          to: path.to.shipments,
          icon: <LuTruck />,
          table: "shipment"
        },
        {
          name: t`Stock Transfers`,
          to: path.to.stockTransfers,
          icon: <LuListChecks />,
          table: "stockTransfer"
        },
        {
          name: t`Warehouse Transfers`,
          to: path.to.warehouseTransfers,
          icon: <LuArrowRightLeft />,
          table: "warehouseTransfer"
        }
      ]
    },
    {
      name: t`Track`,
      routes: [
        {
          name: t`Kanbans`,
          to: path.to.kanbans,
          role: "employee",
          icon: <LuScanQrCode />
        },
        {
          name: t`Quantities`,
          to: path.to.inventory,
          role: "employee",
          icon: <LuTally5 />,
          table: "inventory"
        },
        {
          name: t`Stock Movements`,
          to: path.to.stockMovements,
          role: "employee",
          icon: <LuArrowDownUp />,
          table: "itemLedger"
        },
        {
          name: t`Tracked Entities`,
          to: path.to.trackedEntities,
          role: "employee",
          icon: <LuQrCode />
        },
        {
          name: t`Traceability`,
          to: path.to.traceability,
          role: "employee",
          icon: <LuNetwork />
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Storage Units`,
          to: path.to.storageUnits,
          role: "employee",
          icon: <LuWarehouse />,
          table: "storageUnit"
        },
        {
          name: t`Storage Types`,
          to: path.to.storageTypes,
          role: "employee",
          icon: <LuTag />,
          table: "storageType"
        },
        {
          name: t`Storage Rules`,
          to: path.to.storageRules,
          role: "employee",
          icon: <LuShieldCheck />
        },
        {
          name: t`Shipping Methods`,
          to: path.to.shippingMethods,
          role: "employee",
          icon: <LuTruck />
        }
      ]
    }
  ];

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
          .map(addSavedViewsToRoutes)
      }))
  };
}
