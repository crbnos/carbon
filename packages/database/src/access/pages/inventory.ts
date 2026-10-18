// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

export const INVENTORY_PAGES = [
  {
    id: "inventory.quantities",
    label: "Quantities",
    maxLevel: "Full",
    tables: ["itemLedger"],
    paths: ["/x/inventory/quantities"]
  },
  {
    id: "inventory.movements",
    label: "Movements",
    maxLevel: "Full",
    tables: [],
    readers: ["itemLedger"],
    paths: ["/x/inventory/stock-movements"]
  },
  {
    id: "inventory.inventoryCount",
    label: "Inventory Count",
    maxLevel: "Full",
    tables: ["inventoryCount", "inventoryCountLine"],
    paths: ["/x/inventory/inventory-count", "/x/inventory-count/"]
  },
  {
    id: "inventory.kanbans",
    label: "Kanbans",
    maxLevel: "Full",
    tables: ["kanban"],
    paths: ["/x/inventory/kanbans"]
  },
  {
    id: "inventory.receipts",
    label: "Receipts",
    maxLevel: "Full",
    tables: ["receipt", "receiptLine", "receiptFixedAssetLine"],
    readers: ["purchaseOrder", "batchProperty"],
    paths: ["/x/inventory/receipts", "/x/receipt/"]
  },
  {
    id: "inventory.shipments",
    label: "Shipments",
    maxLevel: "Full",
    tables: ["shipment", "shipmentLine", "shipmentFixedAssetLine"],
    readers: ["salesOrder", "fulfillment"],
    paths: ["/x/inventory/shipments", "/x/shipment/"]
  },
  {
    id: "inventory.pickingLists",
    label: "Picking Lists",
    maxLevel: "Full",
    tables: ["pickingList", "pickingListLine", "pickingListLineTrackedEntity"],
    paths: ["/x/inventory/picking-lists", "/x/picking-list/"]
  },
  {
    id: "inventory.stockTransfers",
    label: "Stock Transfers",
    maxLevel: "Full",
    tables: ["stockTransfer", "stockTransferLine"],
    paths: ["/x/inventory/stock-transfers", "/x/stock-transfer/"]
  },
  {
    id: "inventory.warehouseTransfers",
    label: "Warehouse Transfers",
    maxLevel: "Full",
    tables: ["warehouseTransfer", "warehouseTransferLine"],
    paths: ["/x/inventory/warehouse-transfers", "/x/warehouse-transfer/"]
  },
  {
    id: "inventory.trackedEntities",
    label: "Tracked Entities",
    maxLevel: "Full",
    tables: [
      "trackedEntity",
      "trackedActivity",
      "trackedActivityInput",
      "trackedActivityOutput"
    ],
    readers: ["batchProperty"],
    paths: ["/x/inventory/tracked-entities", "/x/inventory/tracked-entity/"]
  },
  {
    id: "inventory.traceability",
    label: "Traceability",
    maxLevel: "View",
    tables: [],
    paths: ["/x/traceability"]
  },
  {
    id: "inventory.storageUnits",
    label: "Storage Units",
    maxLevel: "Full",
    tables: ["storageUnit"],
    paths: ["/x/inventory/storage-units"]
  },
  {
    id: "inventory.storageTypes",
    label: "Storage Types",
    maxLevel: "Full",
    tables: ["storageType"],
    paths: ["/x/inventory/storage-types"]
  },
  {
    id: "inventory.storageRules",
    label: "Storage Rules",
    maxLevel: "Full",
    tables: ["enforcementRule"],
    where: { table: "enforcementRule", column: "family", value: "storage" },
    children: [
      { table: "enforcementRuleItemAssignment", via: "ruleId" },
      { table: "enforcementRuleWorkCenterAssignment", via: "ruleId" },
      { table: "enforcementRuleAcknowledgment", via: "ruleId" }
    ],
    paths: ["/x/inventory/storage-rules"]
  },
  {
    id: "inventory.shippingMethods",
    label: "Shipping Methods",
    maxLevel: "Full",
    tables: ["shippingMethod", "shippingTerm"],
    paths: ["/x/inventory/shipping-methods"]
  }
] as const satisfies readonly Page[];
