// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  getBatchPropertyColumns,
  getInventoryCounts,
  getPickingLists,
  getReceipts,
  getShipments,
  getShippingMethods,
  getStockMovements,
  getStorageTypes,
  getTrackedEntities,
  getWarehouseTransfers,
  INVENTORY_COUNTS_PAGING,
  PICKING_LISTS_PAGING,
  RECEIPTS_PAGING,
  SHIPMENTS_PAGING,
  SHIPPING_METHODS_PAGING,
  STOCK_MOVEMENTS_PAGING,
  STORAGE_TYPES_PAGING,
  TRACKED_ENTITIES_PAGING,
  WAREHOUSE_TRANSFERS_PAGING
} from "~/modules/inventory/inventory.service";
import { batchPropertyExportValue } from "~/modules/inventory/inventory.utils";
import type { ListDefinition, ListRowsContext } from "./index.server";
import { searchList } from "./index.server";

// The inventory lists. Each entry follows `sales.server.ts`. The quantities,
// kanbans, stock transfers and storage units lists have no entry: their
// loaders read the location from the user's defaults, which a registry query
// cannot see.

export const inventoryCountsList = searchList({
  key: "inventory-counts",
  permission: { view: "inventory" },
  paging: INVENTORY_COUNTS_PAGING,
  service: getInventoryCounts
});

export const pickingListsList = searchList({
  key: "picking-lists",
  permission: { view: "inventory" },
  paging: PICKING_LISTS_PAGING,
  service: getPickingLists,
  params: { status: "status", assignee: "assignee", locationId: () => null }
});

export const receiptsList = searchList({
  key: "receipts",
  permission: { view: "inventory" },
  paging: RECEIPTS_PAGING,
  service: getReceipts
});

export const shipmentsList = searchList({
  key: "shipments",
  permission: { view: "inventory" },
  paging: SHIPMENTS_PAGING,
  service: getShipments
});

export const shippingMethodsList = searchList({
  key: "shipping-methods",
  permission: { view: "inventory", role: "employee" },
  paging: SHIPPING_METHODS_PAGING,
  service: getShippingMethods
});

export const stockMovementsList = searchList({
  key: "stock-movements",
  permission: { view: "inventory" },
  paging: STOCK_MOVEMENTS_PAGING,
  service: getStockMovements
});

export const storageTypesList = searchList({
  key: "storage-types",
  permission: { view: "parts", role: "employee" },
  paging: STORAGE_TYPES_PAGING,
  service: getStorageTypes
});

type TrackedEntityRow = NonNullable<
  Awaited<ReturnType<typeof getTrackedEntities>>["data"]
>[number];

/**
 * Each row's batch property values under their column keys
 * (`property.<label slug>`), as the columns' `meta.exportValue` computes
 * them. The columns are the company's own, so they cannot be a static
 * `exportValues` entry; the background export writes `row[key]`.
 */
async function withBatchPropertyValues(
  rows: TrackedEntityRow[],
  { client, companyId }: ListRowsContext
): Promise<TrackedEntityRow[]> {
  if (rows.length === 0) return rows;
  const columns = await getBatchPropertyColumns(client, companyId);
  if (columns.error) throw columns.error;
  if (columns.data.length === 0) return rows;
  return rows.map((row) => ({
    ...row,
    ...Object.fromEntries(
      columns.data.map((column) => [
        column.key,
        batchPropertyExportValue(column, row)
      ])
    )
  }));
}

export const trackedEntitiesList = searchList({
  key: "tracked-entities",
  permission: { view: "inventory", role: "employee" },
  paging: TRACKED_ENTITIES_PAGING,
  service: getTrackedEntities,
  rows: withBatchPropertyValues
});

export const warehouseTransfersList = searchList({
  key: "warehouse-transfers",
  permission: { view: "inventory" },
  paging: WAREHOUSE_TRANSFERS_PAGING,
  service: getWarehouseTransfers
});

export const inventoryLists: Record<string, ListDefinition> = {
  [inventoryCountsList.key]: inventoryCountsList,
  [pickingListsList.key]: pickingListsList,
  [receiptsList.key]: receiptsList,
  [shipmentsList.key]: shipmentsList,
  [shippingMethodsList.key]: shippingMethodsList,
  [stockMovementsList.key]: stockMovementsList,
  [storageTypesList.key]: storageTypesList,
  [trackedEntitiesList.key]: trackedEntitiesList,
  [warehouseTransfersList.key]: warehouseTransfersList
};
