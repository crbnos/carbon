// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The inventory module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in inventory.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import {
  envelope,
  paged,
  plain,
  stamp
} from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  correctStockMovement,
  createInventoryReconciliationJournal,
  deleteBatchProperty,
  deleteInventoryCount,
  deleteKanban,
  deletePickingList,
  deleteReceipt,
  deleteReceiptLine,
  deleteShipment,
  deleteShipmentLine,
  deleteShippingMethod,
  deleteStockTransfer,
  deleteStockTransferLine,
  deleteStorageTypeWithCascade,
  deleteWarehouseTransfer,
  expandStorageUnitIdsWithDescendants,
  generatePickingList,
  getAvailableTrackedEntities,
  getBatchNumbersForItem,
  getBatchProperties,
  getEffectiveWorkCenterId,
  getInventoryCount,
  getInventoryCountLineSummary,
  getInventoryCountLines,
  getInventoryCountMovements,
  getInventoryCounts,
  getInventoryItems,
  getInventoryValuation,
  getInventoryValuationTieOut,
  getItemLedgerActivity,
  getItemLedgerBalance,
  getKanban,
  getKanbanProjectedQuantities,
  getKanbans,
  getPickingList,
  getPickingListAvailability,
  getPickingListLine,
  getPickingListLines,
  getPickingListRecommendations,
  getPickingListRelatedItems,
  getPickingLists,
  getPickingSchedule,
  getPickOrder,
  getPicksByJobMaterial,
  getReceipt,
  getReceiptFiles,
  getReceiptLines,
  getReceiptRelatedItems,
  getReceipts,
  getRentalReceiptLines,
  getRentalShipmentLines,
  getSerialNumbersForItem,
  getShelfLifeForItems,
  getShipment,
  getShipmentLines,
  getShipmentRelatedItems,
  getShipments,
  getShippingMethod,
  getShippingMethods,
  getShippingMethodsList,
  getShippingTermsList,
  getStockMovementEffectiveQuantity,
  getStockMovements,
  getStockTransfer,
  getStockTransferLines,
  getStockTransfers,
  getStorageType,
  getStorageTypes,
  getStorageTypesList,
  getStorageTypeUsage,
  getStorageUnit,
  getStorageUnitChildren,
  getStorageUnitDescendants,
  getStorageUnitParentIdsWithChildren,
  getStorageUnitRoots,
  getStorageUnitSubtrees,
  getStorageUnitsList,
  getStorageUnitsListForLocation,
  getStorageUnitsTreeForLocation,
  getTrackedEntities,
  getTrackedEntitiesByMakeMethodId,
  getTrackedEntity,
  getTrackedEntityExpirations,
  getWarehouseTransfer,
  getWarehouseTransferLine,
  getWarehouseTransferLines,
  getWarehouseTransferRelatedItems,
  getWarehouseTransfers,
  insertWarehouseTransfer,
  searchStorageUnitsWithAncestors,
  updateBatchPropertyOrder,
  updateInventoryCountLine,
  updateInventoryCountStatus,
  updateTrackedEntityExpiry,
  updateWarehouseTransfer,
  upsertBatchProperty,
  upsertKanban,
  upsertShippingMethod,
  upsertStockTransferLine,
  upsertStorageType,
  upsertStorageUnit
} from "./inventory.service";
import { getReceiptTracking, getShipmentTracking } from "./inventory.utils";

/**
 * Delete batch property
 *
 * @mcp destructive
 */
export const deleteBatchPropertyTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteBatchProperty(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete kanban
 *
 * @mcp destructive
 */
export const deleteKanbanTool = defineServiceFn({
  input: z.looseObject({ kanbanId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteKanban(ctx.asCaller.supabase, input.kanbanId as never)
    );
  }
});

/**
 * Delete receipt
 *
 * @mcp destructive
 */
export const deleteReceiptTool = defineServiceFn({
  input: z.looseObject({ receiptId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteReceipt(ctx.asCaller.supabase, input.receiptId as never)
    );
  }
});

/**
 * Delete receipt line
 *
 * @mcp destructive
 */
export const deleteReceiptLineTool = defineServiceFn({
  input: z.looseObject({ receiptLineId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteReceiptLine(
        ctx.asCaller.supabase,
        input.receiptLineId as never
      )
    );
  }
});

/**
 * Delete shipment
 *
 * @mcp destructive
 */
export const deleteShipmentTool = defineServiceFn({
  input: z.looseObject({ shipmentId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteShipment(ctx.asCaller.supabase, input.shipmentId as never)
    );
  }
});

/**
 * Delete shipment line
 *
 * @mcp destructive
 */
export const deleteShipmentLineTool = defineServiceFn({
  input: z.looseObject({ shipmentLineId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteShipmentLine(
        ctx.asCaller.supabase,
        input.shipmentLineId as never
      )
    );
  }
});

/**
 * Delete shipping method
 *
 * @mcp destructive
 */
export const deleteShippingMethodTool = defineServiceFn({
  input: z.looseObject({ shippingMethodId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteShippingMethod(
        ctx.asCaller.supabase,
        input.shippingMethodId as never
      )
    );
  }
});

/**
 * Delete stock transfer
 *
 * @mcp destructive
 */
export const deleteStockTransferTool = defineServiceFn({
  input: z.looseObject({ stockTransferId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteStockTransfer(
        ctx.asCaller.supabase,
        input.stockTransferId as never
      )
    );
  }
});

/**
 * Delete stock transfer line
 *
 * @mcp destructive
 */
export const deleteStockTransferLineTool = defineServiceFn({
  input: z.looseObject({ stockTransferLineId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteStockTransferLine(
        ctx.asCaller.supabase,
        input.stockTransferLineId as never
      )
    );
  }
});

/**
 * Delete warehouse transfer
 *
 * @mcp destructive
 */
export const deleteWarehouseTransferTool = defineServiceFn({
  input: z.looseObject({ transferId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteWarehouseTransfer(
        ctx.asCaller.supabase,
        input.transferId as never
      )
    );
  }
});

/**
 * Keyset-paginated item-ledger activity for the per-item Activity panel
 *
 * @mcp read
 */
export const getItemLedgerActivityTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    entryNumber: z.number().optional(),
    direction: z.enum(["older", "newer"]).optional(),
    inclusive: z.boolean().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemLedgerActivity(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * On-hand quantity of an item at a location right after ledger entry `entryNumber` (omit it for on-hand now), on the same definition as the inventory table's On…
 *
 * @mcp read
 */
export const getItemLedgerBalanceTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    entryNumber: z.number().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemLedgerBalance(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get batch properties
 *
 * @mcp read
 */
export const getBatchPropertiesTool = defineServiceFn({
  input: z.looseObject({ itemIds: z.array(z.string()) }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getBatchProperties(
        ctx.asCaller.supabase,
        stamp(ctx, input.itemIds, ["companyId"]) as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inventory items
 *
 * @mcp read
 */
export const getInventoryItemsTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional()
    })
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getInventoryItems(
        ctx.asCaller.supabase,
        input.locationId as never,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get inventory valuation
 *
 * @mcp read
 */
export const getInventoryValuationTool = defineServiceFn({
  input: z.looseObject({
    asOfDate: z.string().nullable().optional(),
    locationId: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInventoryValuation(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get inventory valuation tie out
 *
 * @mcp read
 */
export const getInventoryValuationTieOutTool = defineServiceFn({
  input: z.looseObject({ asOfDate: z.string().nullable().optional() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInventoryValuationTieOut(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never
      )
    );
  }
});

/**
 * Creates a draft GL journal that clears the inventory valuation variance
 *
 * @mcp
 */
export const createInventoryReconciliationJournalTool = defineServiceFn({
  input: z.looseObject({ asOfDate: z.string() }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createInventoryReconciliationJournal(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        ctx.company.id,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Get kanbans
 *
 * @mcp read
 */
export const getKanbansTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional()
    })
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getKanbans(
        ctx.asCaller.supabase,
        input.locationId as never,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get kanban
 *
 * @mcp read
 */
export const getKanbanTool = defineServiceFn({
  input: z.looseObject({ kanbanId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getKanban(
        ctx.asCaller.supabase,
        input.kanbanId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get kanban projected quantities
 *
 * @mcp read
 */
export const getKanbanProjectedQuantitiesTool = defineServiceFn({
  input: z.looseObject({ kanbanIds: z.array(z.string()) }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getKanbanProjectedQuantities(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.kanbanIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get stock transfer
 *
 * @mcp read
 */
export const getStockTransferTool = defineServiceFn({
  input: z.looseObject({ stockTransferId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStockTransfer(
        ctx.asCaller.supabase,
        input.stockTransferId as never
      )
    );
  }
});

/**
 * Get stock transfer lines
 *
 * @mcp read
 */
export const getStockTransferLinesTool = defineServiceFn({
  input: z.looseObject({ stockTransferId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStockTransferLines(
        ctx.asCaller.supabase,
        input.stockTransferId as never
      )
    );
  }
});

/**
 * Get stock transfers
 *
 * @mcp read
 */
export const getStockTransfersTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    locationId: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getStockTransfers(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get receipts
 *
 * @mcp read
 */
export const getReceiptsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getReceipts(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get receipt
 *
 * @mcp read
 */
export const getReceiptTool = defineServiceFn({
  input: z.looseObject({ receiptId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getReceipt(ctx.asCaller.supabase, input.receiptId as never)
    );
  }
});

/**
 * Get receipt lines
 *
 * @mcp read
 */
export const getReceiptLinesTool = defineServiceFn({
  input: z.looseObject({ receiptId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getReceiptLines(ctx.asCaller.supabase, input.receiptId as never)
    );
  }
});

/**
 * The documents around a receipt that its own row doesn't name: the purchase invoices raised against its supplier interaction (the PO's, so every receipt of that…
 *
 * @mcp read
 */
export const getReceiptRelatedItemsTool = defineServiceFn({
  input: z.looseObject({
    supplierInteractionId: z.string().nullable(),
    salesReturnOrderId: z.string().nullable()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getReceiptRelatedItems(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.supplierInteractionId as never,
        input.salesReturnOrderId as never
      )
    );
  }
});

/**
 * Get receipt tracking
 *
 * @mcp read
 */
export const getReceiptTrackingTool = defineServiceFn({
  input: z.looseObject({ receiptId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getReceiptTracking(
        ctx.asCaller.supabase,
        input.receiptId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get receipt files
 *
 * @mcp read
 */
export const getReceiptFilesTool = defineServiceFn({
  input: z.looseObject({ lineIds: z.array(z.string()) }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getReceiptFiles(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.lineIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get serial numbers for item
 *
 * @mcp read
 */
export const getSerialNumbersForItemTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSerialNumbersForItem(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Available tracked entities for an item at a location, one row per entity, with its bin, on-hand, and FEFO/FIFO order keys — for the shared TrackedEntityPicker
 *
 * @mcp read
 */
export const getAvailableTrackedEntitiesTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    excludeLineside: z.boolean().optional(),
    excludeAllocated: z.boolean().optional(),
    excludeLineId: z.string().nullable().optional(),
    inStorageUnit: z.looseObject({ id: z.string().nullable() }).optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAvailableTrackedEntities(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * The configured tracked-entity pick order for an item at a location, used as the picker's default sort
 *
 * @mcp read
 */
export const getPickOrderTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getPickOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get batch numbers for item
 *
 * @mcp read
 */
export const getBatchNumbersForItemTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    isReadOnly: z.boolean().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getBatchNumbersForItem(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get storage units list
 *
 * @mcp read
 */
export const getStorageUnitsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "inventory" },
  async run(ctx) {
    return envelope(
      ctx,
      await getStorageUnitsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get storage units list for location
 *
 * @mcp read
 */
export const getStorageUnitsListForLocationTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStorageUnitsListForLocation(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get storage units tree for location
 *
 * @mcp read
 */
export const getStorageUnitsTreeForLocationTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStorageUnitsTreeForLocation(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get storage unit
 *
 * @mcp read
 */
export const getStorageUnitTool = defineServiceFn({
  input: z.looseObject({ storageUnitId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStorageUnit(ctx.asCaller.supabase, input.storageUnitId as never)
    );
  }
});

/**
 * Get effective work center id
 *
 * @mcp read
 */
export const getEffectiveWorkCenterIdTool = defineServiceFn({
  input: z.looseObject({ storageUnitId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getEffectiveWorkCenterId(
        ctx.asCaller.supabase,
        input.storageUnitId as never
      )
    );
  }
});

/**
 * Get storage unit roots
 *
 * @mcp read
 */
export const getStorageUnitRootsTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional()
    })
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getStorageUnitRoots(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get storage unit children
 *
 * @mcp read
 */
export const getStorageUnitChildrenTool = defineServiceFn({
  input: z.looseObject({ parentId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStorageUnitChildren(
        ctx.asCaller.supabase,
        input.parentId as never
      )
    );
  }
});

/**
 * Get storage unit subtrees
 *
 * @mcp read
 */
export const getStorageUnitSubtreesTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    rootIds: z.array(z.string()),
    maxDepth: z.number()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStorageUnitSubtrees(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never,
        stamp(ctx, input.rootIds, ["companyId"]) as never,
        input.maxDepth as never
      )
    );
  }
});

/**
 * Get storage unit parent ids with children
 *
 * @mcp read
 */
export const getStorageUnitParentIdsWithChildrenTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStorageUnitParentIdsWithChildren(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Search storage units with ancestors
 *
 * @mcp read
 */
export const searchStorageUnitsWithAncestorsTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string(), search: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await searchStorageUnitsWithAncestors(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never,
        input.search as never
      )
    );
  }
});

/**
 * Get stock movements
 *
 * @mcp read
 */
export const getStockMovementsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getStockMovements(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get shipments
 *
 * @mcp read
 */
export const getShipmentsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getShipments(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get shipment
 *
 * @mcp read
 */
export const getShipmentTool = defineServiceFn({
  input: z.looseObject({ shipmentId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getShipment(ctx.asCaller.supabase, input.shipmentId as never)
    );
  }
});

/**
 * Get shipment lines
 *
 * @mcp read
 */
export const getShipmentLinesTool = defineServiceFn({
  input: z.looseObject({ shipmentId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getShipmentLines(ctx.asCaller.supabase, input.shipmentId as never)
    );
  }
});

/**
 * Get shipment related items
 *
 * @mcp read
 */
export const getShipmentRelatedItemsTool = defineServiceFn({
  input: z.looseObject({
    shipmentId: z.string(),
    sourceDocumentId: z.string()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getShipmentRelatedItems(
        ctx.asCaller.supabase,
        input.shipmentId as never,
        input.sourceDocumentId as never
      )
    );
  }
});

/**
 * Get shipment tracking
 *
 * @mcp read
 */
export const getShipmentTrackingTool = defineServiceFn({
  input: z.looseObject({ shipmentId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getShipmentTracking(
        ctx.asCaller.supabase,
        input.shipmentId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get rental shipment lines
 *
 * @mcp read
 */
export const getRentalShipmentLinesTool = defineServiceFn({
  input: z.looseObject({ shipmentId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRentalShipmentLines(
        ctx.asCaller.supabase,
        input.shipmentId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get rental receipt lines
 *
 * @mcp read
 */
export const getRentalReceiptLinesTool = defineServiceFn({
  input: z.looseObject({ receiptId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRentalReceiptLines(
        ctx.asCaller.supabase,
        input.receiptId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get shipping method
 *
 * @mcp read
 */
export const getShippingMethodTool = defineServiceFn({
  input: z.looseObject({ shippingMethodId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getShippingMethod(
        ctx.asCaller.supabase,
        input.shippingMethodId as never
      )
    );
  }
});

/**
 * Get shipping methods
 *
 * @mcp read
 */
export const getShippingMethodsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getShippingMethods(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get shipping methods list
 *
 * @mcp read
 */
export const getShippingMethodsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "inventory" },
  async run(ctx) {
    return envelope(
      ctx,
      await getShippingMethodsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get shipping terms list
 *
 * @mcp read
 */
export const getShippingTermsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "inventory" },
  async run(ctx) {
    return envelope(
      ctx,
      await getShippingTermsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get tracked entities
 *
 * @mcp read
 */
export const getTrackedEntitiesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getTrackedEntities(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get tracked entities by make method id
 *
 * @mcp read
 */
export const getTrackedEntitiesByMakeMethodIdTool = defineServiceFn({
  input: z.looseObject({ jobMakeMethodId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTrackedEntitiesByMakeMethodId(
        ctx.asCaller.supabase,
        input.jobMakeMethodId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get tracked entity
 *
 * @mcp read
 */
export const getTrackedEntityTool = defineServiceFn({
  input: z.looseObject({ trackedEntityId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTrackedEntity(
        ctx.asCaller.supabase,
        input.trackedEntityId as never
      )
    );
  }
});

/**
 * Manual override of a tracked entity's expirationDate
 *
 * @mcp
 */
export const updateTrackedEntityExpiryTool = defineServiceFn({
  input: z.looseObject({
    trackedEntityId: z.string(),
    expirationDate: z.string().nullable(),
    reason: z.string(),
    source: z.string().optional()
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateTrackedEntityExpiry(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Get warehouse transfers
 *
 * @mcp read
 */
export const getWarehouseTransfersTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getWarehouseTransfers(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get warehouse transfer
 *
 * @mcp read
 */
export const getWarehouseTransferTool = defineServiceFn({
  input: z.looseObject({ transferId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getWarehouseTransfer(
        ctx.asCaller.supabase,
        input.transferId as never
      )
    );
  }
});

/**
 * The documents a warehouse transfer has raised: the shipments that send it out of the source location and the receipts that take it in at the destination
 *
 * @mcp read
 */
export const getWarehouseTransferRelatedItemsTool = defineServiceFn({
  input: z.looseObject({ transferId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getWarehouseTransferRelatedItems(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.transferId as never
      )
    );
  }
});

/**
 * Get warehouse transfer line
 *
 * @mcp read
 */
export const getWarehouseTransferLineTool = defineServiceFn({
  input: z.looseObject({ transferId: z.string(), lineId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getWarehouseTransferLine(
        ctx.asCaller.supabase,
        input.transferId as never,
        input.lineId as never
      )
    );
  }
});

/**
 * Get warehouse transfer lines
 *
 * @mcp read
 */
export const getWarehouseTransferLinesTool = defineServiceFn({
  input: z.looseObject({ transferId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getWarehouseTransferLines(
        ctx.asCaller.supabase,
        input.transferId as never
      )
    );
  }
});

/**
 * Get stock movement effective quantity
 *
 * @mcp read
 */
export const getStockMovementEffectiveQuantityTool = defineServiceFn({
  input: z.looseObject({ itemLedgerId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStockMovementEffectiveQuantity(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.itemLedgerId as never
      )
    );
  }
});

/**
 * Correct stock movement
 *
 * @mcp
 */
export const correctStockMovementTool = defineServiceFn({
  input: z.looseObject({
    correctedQuantity: z.number(),
    comment: z.string().optional(),
    itemLedgerId: z.string()
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await correctStockMovement(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get inventory counts
 *
 * @mcp read
 */
export const getInventoryCountsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getInventoryCounts(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get inventory count
 *
 * @mcp read
 */
export const getInventoryCountTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInventoryCount(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inventory count lines
 *
 * @mcp read
 */
export const getInventoryCountLinesTool = defineServiceFn({
  input: z.looseObject({
    inventoryCountId: z.string(),
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional()
    })
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getInventoryCountLines(
        ctx.asCaller.supabase,
        input.inventoryCountId as never,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get inventory count line summary
 *
 * @mcp read
 */
export const getInventoryCountLineSummaryTool = defineServiceFn({
  input: z.looseObject({ inventoryCountId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getInventoryCountLineSummary(
        ctx.asCaller.supabase,
        input.inventoryCountId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get inventory count movements
 *
 * @mcp read
 */
export const getInventoryCountMovementsTool = defineServiceFn({
  input: z.looseObject({ inventoryCountId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInventoryCountMovements(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.inventoryCountId as never
      )
    );
  }
});

/**
 * Delete inventory count
 *
 * @mcp destructive
 */
export const deleteInventoryCountTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteInventoryCount(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Update inventory count line
 *
 * @mcp
 */
export const updateInventoryCountLineTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().min(1),
    countedQuantity: z.number().min(0).optional(),
    countedBy: z.string()
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updateInventoryCountLine(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update inventory count status
 *
 * @mcp
 */
export const updateInventoryCountStatusTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    status: z.enum(["Draft", "Pending", "Posted"]),
    expectedStatus: z.enum(["Draft", "Pending", "Posted"]).optional()
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateInventoryCountStatus(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update batch property order
 *
 * @mcp
 */
export const updateBatchPropertyOrderTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().min(1),
    sortOrder: z.number().min(0),
    batchPropertyGroupId: z.string().nullable().optional()
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateBatchPropertyOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Upsert batch property
 *
 * @mcp
 */
export const upsertBatchPropertyTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    itemId: z.string().min(1),
    label: z.string().min(1),
    dataType: z.enum(["text", "numeric", "boolean", "list", "date"]),
    listOptions: z.array(z.string().min(1)).optional(),
    configurationParameterGroupId: z.string().optional()
  }),
  permission: { create: "inventory", update: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertBatchProperty(
        ctx.asCaller.supabase,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Create a kanban
 *
 * @remarks
 * Upsert kanban
 *
 * @mcp
 */
export const upsertKanbanCreateTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string().min(1),
    replenishmentSystem: z.enum(["Buy", "Make", "Transfer"]),
    autoRelease: z.boolean().optional(),
    autoStartJob: z.boolean().optional(),
    completedBarcodeOverride: z.string().optional(),
    quantity: z.number().int().min(1),
    locationId: z.string().min(1),
    storageUnitId: z.string().optional(),
    fromStorageUnitId: z.string().optional(),
    supplierId: z.string().optional(),
    purchaseUnitOfMeasureCode: z.string().optional(),
    conversionFactor: z
      .number()
      .min(0)
      .default(1)
      .describe(
        "Applied when creating; on update a field left out keeps its value."
      ),
    replenishmentLevel: z.number().min(0).optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertKanban(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a kanban
 *
 * @remarks
 * Upsert kanban
 *
 * @mcp
 */
export const upsertKanbanUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      itemId: z.string().min(1),
      replenishmentSystem: z.enum(["Buy", "Make", "Transfer"]),
      autoRelease: z.boolean().optional(),
      autoStartJob: z.boolean().optional(),
      completedBarcodeOverride: z.string().optional(),
      quantity: z.number().int().min(1),
      locationId: z.string().min(1),
      storageUnitId: z.string().optional(),
      fromStorageUnitId: z.string().optional(),
      supplierId: z.string().optional(),
      purchaseUnitOfMeasureCode: z.string().optional(),
      conversionFactor: z
        .number()
        .min(0)
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      replenishmentLevel: z.number().min(0).optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertKanban(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a storage unit
 *
 * @remarks
 * Upsert storage unit
 *
 * @mcp
 */
export const upsertStorageUnitCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    locationId: z.string().min(1),
    warehouseId: z.string().optional(),
    parentId: z.string().optional(),
    workCenterId: z.string().optional(),
    storageTypeIds: z.array(z.string()).optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertStorageUnit(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a storage unit
 *
 * @remarks
 * Upsert storage unit
 *
 * @mcp
 */
export const upsertStorageUnitUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      locationId: z.string().min(1),
      warehouseId: z.string().optional(),
      parentId: z.string().optional(),
      workCenterId: z.string().optional(),
      storageTypeIds: z.array(z.string()).optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertStorageUnit(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a shipping method
 *
 * @remarks
 * Upsert shipping method
 *
 * @mcp
 */
export const upsertShippingMethodCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    carrier: z.enum(["UPS", "FedEx", "USPS", "DHL", "Other"]),
    carrierAccountId: z.string().optional(),
    trackingUrl: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertShippingMethod(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a shipping method
 *
 * @remarks
 * Upsert shipping method
 *
 * @mcp
 */
export const upsertShippingMethodUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      carrier: z.enum(["UPS", "FedEx", "USPS", "DHL", "Other"]),
      carrierAccountId: z.string().optional(),
      trackingUrl: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertShippingMethod(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a stock transfer line
 *
 * @remarks
 * Upsert stock transfer line
 *
 * @mcp
 */
export const upsertStockTransferLineCreateTool = defineServiceFn({
  input: z.looseObject({
    stockTransferId: z.string().min(1),
    itemId: z.string().min(1),
    fromStorageUnitId: z.string().optional(),
    toStorageUnitId: z.string().optional(),
    quantity: z.number().min(0),
    pickedQuantity: z.number().min(0).optional(),
    requiresBatchTracking: z.enum(["true", "false"]),
    requiresSerialTracking: z.enum(["true", "false"]),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertStockTransferLine(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a stock transfer line
 *
 * @remarks
 * Upsert stock transfer line
 *
 * @mcp
 */
export const upsertStockTransferLineUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      stockTransferId: z.string().min(1),
      itemId: z.string().min(1),
      fromStorageUnitId: z.string().optional(),
      toStorageUnitId: z.string().optional(),
      quantity: z.number().min(0),
      pickedQuantity: z.number().min(0).optional(),
      requiresBatchTracking: z.enum(["true", "false"]),
      requiresSerialTracking: z.enum(["true", "false"]),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertStockTransferLine(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Get storage unit descendants
 *
 * @mcp read
 */
export const getStorageUnitDescendantsTool = defineServiceFn({
  input: z.looseObject({ storageUnitId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStorageUnitDescendants(
        ctx.asCaller.supabase,
        input.storageUnitId as never
      )
    );
  }
});

/**
 * Expand storage unit ids with descendants
 *
 * @mcp
 */
export const expandStorageUnitIdsWithDescendantsTool = defineServiceFn({
  input: z.looseObject({ storageUnitIds: z.array(z.string()) }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return plain(
      ctx,
      await expandStorageUnitIdsWithDescendants(
        ctx.asCaller.supabase,
        stamp(ctx, input.storageUnitIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get storage type usage
 *
 * @mcp read
 */
export const getStorageTypeUsageTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStorageTypeUsage(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete storage type with cascade
 *
 * @mcp destructive
 */
export const deleteStorageTypeWithCascadeTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteStorageTypeWithCascade(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get storage types
 *
 * @mcp read
 */
export const getStorageTypesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getStorageTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get storage type
 *
 * @mcp read
 */
export const getStorageTypeTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStorageType(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get storage types list
 *
 * @mcp read
 */
export const getStorageTypesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "inventory" },
  async run(ctx) {
    return envelope(
      ctx,
      await getStorageTypesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Create a storage type
 *
 * @remarks
 * Upsert storage type
 *
 * @mcp
 */
export const upsertStorageTypeCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertStorageType(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a storage type
 *
 * @remarks
 * Upsert storage type
 *
 * @mcp
 */
export const upsertStorageTypeUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertStorageType(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Get shelf life for items
 *
 * @mcp read
 */
export const getShelfLifeForItemsTool = defineServiceFn({
  input: z.looseObject({ itemIds: z.array(z.string()) }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getShelfLifeForItems(
        ctx.asCaller.supabase,
        stamp(ctx, input.itemIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Map of trackedEntityId → expirationDate (or null) for a set of ids
 *
 * @mcp read
 */
export const getTrackedEntityExpirationsTool = defineServiceFn({
  input: z.looseObject({ trackedEntityIds: z.array(z.string()) }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getTrackedEntityExpirations(
        ctx.asCaller.supabase,
        stamp(ctx, input.trackedEntityIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get picking lists
 *
 * @mcp read
 */
export const getPickingListsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    assignee: z.string().nullable().optional(),
    locationId: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getPickingLists(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get picking list
 *
 * @mcp read
 */
export const getPickingListTool = defineServiceFn({
  input: z.looseObject({ pickingListId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPickingList(ctx.asCaller.supabase, input.pickingListId as never)
    );
  }
});

/**
 * Get picks by job material
 *
 * @mcp read
 */
export const getPicksByJobMaterialTool = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPicksByJobMaterial(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get picking list lines
 *
 * @mcp read
 */
export const getPickingListLinesTool = defineServiceFn({
  input: z.looseObject({ pickingListId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPickingListLines(
        ctx.asCaller.supabase,
        input.pickingListId as never
      )
    );
  }
});

/**
 * The documents around a picking list that its own row doesn't name: the jobs its lines pick for, with their status
 *
 * @mcp read
 */
export const getPickingListRelatedItemsTool = defineServiceFn({
  input: z.looseObject({ pickingListId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getPickingListRelatedItems(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.pickingListId as never
      )
    );
  }
});

/**
 * Per-line WAREHOUSE (non-lineside, incl
 *
 * @mcp read
 */
export const getPickingListAvailabilityTool = defineServiceFn({
  input: z.looseObject({ pickingListId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getPickingListAvailability(
        ctx.asCaller.supabase,
        input.pickingListId as never
      )
    );
  }
});

/**
 * The recommended tracked entities (serial/batch lots) for each tracked picking line, in pick order — surfaced as at-a-glance subtext before the picker opens
 *
 * @mcp read
 */
export const getPickingListRecommendationsTool = defineServiceFn({
  input: z.looseObject({ pickingListId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getPickingListRecommendations(
        ctx.asCaller.supabase,
        input.pickingListId as never
      )
    );
  }
});

/**
 * Get picking list line
 *
 * @mcp read
 */
export const getPickingListLineTool = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPickingListLine(ctx.asCaller.supabase, input.lineId as never)
    );
  }
});

/**
 * Delete picking list
 *
 * @mcp destructive
 */
export const deletePickingListTool = defineServiceFn({
  input: z.looseObject({ pickingListId: z.string() }),
  permission: { delete: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deletePickingList(
        ctx.asCaller.supabase,
        input.pickingListId as never
      )
    );
  }
});

/**
 * Get picking schedule
 *
 * @mcp read
 */
export const getPickingScheduleTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    search: z.string().nullable().optional()
  }),
  permission: { view: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPickingSchedule(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Generate picking list
 *
 * @mcp destructive
 */
export const generatePickingListTool = defineServiceFn({
  input: z.looseObject({
    jobOperationIds: z.array(z.string()),
    locationId: z.string(),
    assignee: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional()
  }),
  permission: { create: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await generatePickingList(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a warehouse transfer between locations
 *
 * @remarks
 * Create a warehouse transfer between locations. Generates sequence ID automatically.
 *
 * @mcp
 */
export const insertWarehouseTransferTool = defineServiceFn({
  input: z.looseObject({
    fromLocationId: z.string(),
    toLocationId: z.string(),
    transferId: z.string().optional(),
    status: z
      .enum([
        "Draft",
        "To Ship and Receive",
        "To Ship",
        "To Receive",
        "Completed",
        "Cancelled"
      ])
      .optional(),
    transferDate: z.string().optional(),
    expectedReceiptDate: z.string().optional(),
    notes: z.string().optional(),
    reference: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertWarehouseTransfer(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update an existing warehouse transfer
 *
 * @mcp
 */
export const updateWarehouseTransferTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    fromLocationId: z.string().optional(),
    toLocationId: z.string().optional(),
    transferId: z.string().optional(),
    status: z
      .enum([
        "Draft",
        "To Ship and Receive",
        "To Ship",
        "To Receive",
        "Completed",
        "Cancelled"
      ])
      .optional(),
    transferDate: z.string().optional(),
    expectedReceiptDate: z.string().optional(),
    notes: z.string().optional(),
    reference: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "inventory" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateWarehouseTransfer(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});
