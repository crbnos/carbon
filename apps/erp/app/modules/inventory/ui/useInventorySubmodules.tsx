// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuArrowDownUp,
  LuArrowRightLeft,
  LuClipboardCheck,
  LuClipboardList,
  LuClipboardX,
  LuHandCoins,
  LuListChecks,
  LuNetwork,
  LuPackageCheck,
  LuPackageMinus,
  LuQrCode,
  LuScanQrCode,
  LuShieldCheck,
  LuTag,
  LuTally5,
  LuTruck,
  LuWarehouse
} from "react-icons/lu";
import { GroupedContentSidebar } from "~/components/Layout";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";
import type { receiptInspectionStatusType } from "../inventory.models";

const receiptsByInspectionStatus = (
  statuses: (typeof receiptInspectionStatusType)[number][]
) =>
  `${path.to.receipts}?filter=${encodeURIComponent(
    `inspectionStatus:in:${statuses.join(",")}`
  )}`;

export default function useInventorySubmodules() {
  const permissions = usePermissions();
  const { t } = useLingui();
  const { addSavedViewsToRoutes } = useSavedViews();

  const inventoryRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Stock`,
      routes: [
        {
          name: t`Quantities`,
          to: path.to.inventory,
          page: "inventory.quantities",
          role: "employee",
          icon: <LuTally5 />,
          table: "inventory"
        },
        {
          name: t`Movements`,
          to: path.to.stockMovements,
          page: "inventory.movements",
          role: "employee",
          icon: <LuArrowDownUp />,
          table: "itemLedger"
        },
        {
          name: t`Inventory Count`,
          to: path.to.inventoryCounts,
          page: "inventory.inventoryCount",
          icon: <LuClipboardCheck />,
          table: "inventoryCount"
        },
        {
          name: t`Issue to Project`,
          to: path.to.projectIssue,
          page: "projects.projects",
          icon: <LuPackageMinus />
        },
        {
          name: t`Kanbans`,
          to: path.to.kanbans,
          page: "inventory.kanbans",
          role: "employee",
          icon: <LuScanQrCode />
        }
      ]
    },
    {
      name: t`Shipping & Receiving`,
      routes: [
        {
          name: t`Receipts`,
          to: path.to.receipts,
          page: "inventory.receipts",
          icon: <LuHandCoins />,
          table: "receipt"
        },
        {
          name: t`Pending inspection`,
          to: receiptsByInspectionStatus([
            "Pending Inspection",
            "Inspection In Progress"
          ]),
          page: "inventory.receipts",
          icon: <LuClipboardCheck />
        },
        {
          name: t`Ready for putaway`,
          to: receiptsByInspectionStatus([
            "Inspection Passed",
            "Partially Passed"
          ]),
          page: "inventory.receipts",
          icon: <LuPackageCheck />
        },
        {
          name: t`Inspection failed`,
          to: receiptsByInspectionStatus(["Inspection Failed"]),
          page: "inventory.receipts",
          icon: <LuClipboardX />
        },
        {
          name: t`Shipments`,
          to: path.to.shipments,
          page: "inventory.shipments",
          icon: <LuTruck />,
          table: "shipment"
        }
      ]
    },
    {
      name: t`Transfers`,
      routes: [
        {
          name: t`Picking Lists`,
          to: path.to.pickingLists,
          page: "inventory.pickingLists",
          icon: <LuClipboardList />
        },
        {
          name: t`Stock Transfers`,
          to: path.to.stockTransfers,
          page: "inventory.stockTransfers",
          icon: <LuListChecks />,
          table: "stockTransfer"
        },
        {
          name: t`Warehouse Transfers`,
          to: path.to.warehouseTransfers,
          page: "inventory.warehouseTransfers",
          icon: <LuArrowRightLeft />,
          table: "warehouseTransfer"
        }
      ]
    },
    {
      name: t`Traceability`,
      routes: [
        {
          name: t`Tracked Entities`,
          to: path.to.trackedEntities,
          page: "inventory.trackedEntities",
          role: "employee",
          icon: <LuQrCode />
        },
        {
          name: t`Traceability`,
          to: path.to.traceability,
          page: "inventory.traceability",
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
          page: "inventory.storageUnits",
          role: "employee",
          icon: <LuWarehouse />,
          table: "storageUnit"
        },
        {
          name: t`Storage Types`,
          to: path.to.storageTypes,
          page: "inventory.storageTypes",
          role: "employee",
          icon: <LuTag />,
          table: "storageType"
        },
        {
          name: t`Storage Rules`,
          to: path.to.storageRules,
          page: "inventory.storageRules",
          role: "employee",
          icon: <LuShieldCheck />
        },
        {
          name: t`Shipping Methods`,
          to: path.to.shippingMethods,
          page: "inventory.shippingMethods",
          role: "employee",
          icon: <LuTruck />
        }
      ]
    }
  ];

  const isRouteVisible = (route: AuthenticatedRouteGroup["routes"][number]) =>
    (!route.role || permissions.is(route.role)) &&
    (!route.page || permissions.has({ [route.page]: "View" }));

  return {
    groups: inventoryRoutes
      .map((group) => ({
        ...group,
        routes: group.routes.filter(isRouteVisible).map(addSavedViewsToRoutes)
      }))
      .filter((group) => group.routes.length > 0)
  };
}

/** Phones: the module's section switcher, for routes outside the module's
 *  own layout (`handle.compactSidebar`). */
export function InventorySections() {
  const { groups } = useInventorySubmodules();
  return <GroupedContentSidebar groups={groups} />;
}
