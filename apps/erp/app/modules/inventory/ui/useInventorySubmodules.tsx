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
import { PROJECT_ISSUE_GATE } from "~/modules/projects/projects.models";
import type { AuthenticatedRouteGroup } from "~/types";
import { visibleGroups } from "~/utils/nav";
import { path } from "~/utils/path";
import {
  type receiptInspectionStatusType,
  storageTypesGate
} from "../inventory.models";

const receiptsByInspectionStatus = (
  statuses: (typeof receiptInspectionStatusType)[number][]
) =>
  `${path.to.receipts}?filter=${encodeURIComponent(
    `inspectionStatus:in:${statuses.join(",")}`
  )}`;

const receiptsRejectedAtInspection = `${path.to.receipts}?filter=${encodeURIComponent(
  "rejectedAtInspection:eq:true"
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
          icon: <LuTally5 />,
          table: "inventory"
        },
        {
          name: t`Movements`,
          to: path.to.stockMovements,
          icon: <LuArrowDownUp />,
          table: "itemLedger"
        },
        {
          name: t`Inventory Count`,
          to: path.to.inventoryCounts,
          icon: <LuClipboardCheck />,
          table: "inventoryCount"
        },
        {
          name: t`Issue to Project`,
          to: path.to.projectIssue,
          gate: PROJECT_ISSUE_GATE,
          icon: <LuPackageMinus />
        },
        {
          name: t`Kanbans`,
          to: path.to.kanbans,
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
          icon: <LuHandCoins />,
          table: "receipt"
        },
        {
          name: t`Pending inspection`,
          to: receiptsByInspectionStatus([
            "Pending Inspection",
            "Inspection In Progress"
          ]),
          icon: <LuClipboardCheck />
        },
        {
          name: t`Ready for putaway`,
          to: receiptsByInspectionStatus([
            "Inspection Passed",
            "Partially Passed"
          ]),
          icon: <LuPackageCheck />
        },
        {
          name: t`Inspection failed`,
          // Not a status filter: a receipt with a Partial lot reads Put Away
          // once its passed stock is put away, and must stay listed here.
          to: receiptsRejectedAtInspection,
          icon: <LuClipboardX />
        },
        {
          name: t`Shipments`,
          to: path.to.shipments,
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
          icon: <LuClipboardList />
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
      name: t`Traceability`,
      routes: [
        {
          name: t`Tracked Entities`,
          to: path.to.trackedEntities,
          icon: <LuQrCode />
        },
        {
          name: t`Traceability`,
          to: path.to.traceability,
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
          icon: <LuWarehouse />,
          table: "storageUnit"
        },
        {
          name: t`Storage Types`,
          to: path.to.storageTypes,
          gate: storageTypesGate("View"),
          icon: <LuTag />,
          table: "storageType"
        },
        {
          name: t`Storage Rules`,
          to: path.to.storageRules,
          icon: <LuShieldCheck />
        },
        {
          name: t`Shipping Methods`,
          to: path.to.shippingMethods,
          icon: <LuTruck />
        }
      ]
    }
  ];

  return {
    groups: visibleGroups(inventoryRoutes, permissions).map((group) => ({
      ...group,
      routes: group.routes.map(addSavedViewsToRoutes)
    }))
  };
}

/** The module sidebar for its boards outside the module layout
 *  (`handle.boardSidebar`): the phone switcher, and the desktop sidebar when shown. */
export function InventorySections() {
  const { groups } = useInventorySubmodules();
  return <GroupedContentSidebar groups={groups} />;
}
