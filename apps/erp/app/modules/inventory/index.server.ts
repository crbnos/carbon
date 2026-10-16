// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  adjustInventory,
  assignReceiptReturnEntity,
  assignShipmentLineEntity,
  createInventoryCount,
  createReceipt,
  createShipment,
  createStockTransfer,
  createWarehouseTransferLine,
  pickPickingListLineChecked,
  pickPickingListLineEntity,
  pickStockTransferLine,
  pickStockTransferLineEntity,
  postInventoryCount,
  postReceipt,
  postShipment,
  removeReceiptReturnEntity,
  removeStorageUnit,
  removeWarehouseTransferLine,
  scanKanban,
  setPickingListStatus,
  setReceiptLineBatch,
  setReceiptLineSerial,
  setStockTransferStatus,
  setWarehouseTransferStatus,
  splitReceiptLine,
  splitShipmentLine,
  unpickStockTransferLine,
  updatePickingList,
  updateReceipt,
  updateReceiptFixedAssetLine,
  updateReceiptLines,
  updateShipment,
  updateShipmentFixedAssetLine,
  updateShipmentLines,
  updateStockTransferLines,
  updateWarehouseTransferLine,
  voidReceipt,
  voidShipment
} from "./inventory.server";
import {
  correctStockMovementTool,
  createInventoryReconciliationJournalTool,
  deleteBatchPropertyTool,
  deleteInventoryCountTool,
  deleteKanbanTool,
  deletePickingListTool,
  deleteReceiptLineTool,
  deleteReceiptTool,
  deleteShipmentLineTool,
  deleteShipmentTool,
  deleteShippingMethodTool,
  deleteStockTransferLineTool,
  deleteStockTransferTool,
  deleteStorageTypeWithCascadeTool,
  deleteWarehouseTransferTool,
  expandStorageUnitIdsWithDescendantsTool,
  generatePickingListTool,
  getAvailableTrackedEntitiesTool,
  getBatchNumbersForItemTool,
  getBatchPropertiesTool,
  getEffectiveWorkCenterIdTool,
  getInventoryCountLineSummaryTool,
  getInventoryCountLinesTool,
  getInventoryCountMovementsTool,
  getInventoryCountsTool,
  getInventoryCountTool,
  getInventoryItemsTool,
  getInventoryValuationTieOutTool,
  getInventoryValuationTool,
  getItemLedgerActivityTool,
  getItemLedgerBalanceTool,
  getKanbanProjectedQuantitiesTool,
  getKanbansTool,
  getKanbanTool,
  getPickingListAvailabilityTool,
  getPickingListLinesTool,
  getPickingListLineTool,
  getPickingListRecommendationsTool,
  getPickingListRelatedItemsTool,
  getPickingListsTool,
  getPickingListTool,
  getPickingScheduleTool,
  getPickOrderTool,
  getPicksByJobMaterialTool,
  getReceiptFilesTool,
  getReceiptLinesTool,
  getReceiptRelatedItemsTool,
  getReceiptsTool,
  getReceiptTool,
  getReceiptTrackingTool,
  getRentalReceiptLinesTool,
  getRentalShipmentLinesTool,
  getSerialNumbersForItemTool,
  getShelfLifeForItemsTool,
  getShipmentLinesTool,
  getShipmentRelatedItemsTool,
  getShipmentsTool,
  getShipmentTool,
  getShipmentTrackingTool,
  getShippingMethodsListTool,
  getShippingMethodsTool,
  getShippingMethodTool,
  getShippingTermsListTool,
  getStockMovementEffectiveQuantityTool,
  getStockMovementsTool,
  getStockTransferLinesTool,
  getStockTransfersTool,
  getStockTransferTool,
  getStorageTypesListTool,
  getStorageTypesTool,
  getStorageTypeTool,
  getStorageTypeUsageTool,
  getStorageUnitChildrenTool,
  getStorageUnitDescendantsTool,
  getStorageUnitParentIdsWithChildrenTool,
  getStorageUnitRootsTool,
  getStorageUnitSubtreesTool,
  getStorageUnitsListForLocationTool,
  getStorageUnitsListTool,
  getStorageUnitsTreeForLocationTool,
  getStorageUnitTool,
  getTrackedEntitiesByMakeMethodIdTool,
  getTrackedEntitiesTool,
  getTrackedEntityExpirationsTool,
  getTrackedEntityTool,
  getWarehouseTransferLinesTool,
  getWarehouseTransferLineTool,
  getWarehouseTransferRelatedItemsTool,
  getWarehouseTransfersTool,
  getWarehouseTransferTool,
  insertWarehouseTransferTool,
  searchStorageUnitsWithAncestorsTool,
  updateBatchPropertyOrderTool,
  updateInventoryCountLineTool,
  updateInventoryCountStatusTool,
  updateTrackedEntityExpiryTool,
  updateWarehouseTransferTool,
  upsertBatchPropertyTool,
  upsertKanbanCreateTool,
  upsertKanbanUpdateTool,
  upsertShippingMethodCreateTool,
  upsertShippingMethodUpdateTool,
  upsertStockTransferLineCreateTool,
  upsertStockTransferLineUpdateTool,
  upsertStorageTypeCreateTool,
  upsertStorageTypeUpdateTool,
  upsertStorageUnitCreateTool,
  upsertStorageUnitUpdateTool
} from "./inventory.tools.server";

/** The inventory module's operations, by entity. */
export const inventory = {
  item: { adjust: adjustInventory },
  kanban: {
    scan: scanKanban,
    delete: deleteKanbanTool,
    get: getKanbanTool,
    create: upsertKanbanCreateTool,
    update: upsertKanbanUpdateTool
  },
  pickingList: {
    setStatus: setPickingListStatus,
    update: updatePickingList,
    line: {
      pick: pickPickingListLineChecked,
      pickEntity: pickPickingListLineEntity
    },
    get: getPickingListTool,
    delete: deletePickingListTool,
    generate: generatePickingListTool
  },
  inventoryCount: {
    create: createInventoryCount,
    post: postInventoryCount,
    get: getInventoryCountTool,
    delete: deleteInventoryCountTool
  },
  storageUnit: {
    delete: removeStorageUnit,
    get: getStorageUnitTool,
    create: upsertStorageUnitCreateTool,
    update: upsertStorageUnitUpdateTool
  },
  receipt: {
    create: createReceipt,
    update: updateReceipt,
    post: postReceipt,
    void: voidReceipt,
    lines: { update: updateReceiptLines },
    line: {
      split: splitReceiptLine,
      setBatch: setReceiptLineBatch,
      setSerial: setReceiptLineSerial,
      assignReturnEntity: assignReceiptReturnEntity,
      removeReturnEntity: removeReceiptReturnEntity
    },
    fixedAssetLine: { update: updateReceiptFixedAssetLine },
    delete: deleteReceiptTool,
    get: getReceiptTool
  },
  shipment: {
    create: createShipment,
    update: updateShipment,
    post: postShipment,
    void: voidShipment,
    lines: { update: updateShipmentLines },
    line: { split: splitShipmentLine, assignEntity: assignShipmentLineEntity },
    fixedAssetLine: { update: updateShipmentFixedAssetLine },
    delete: deleteShipmentTool,
    get: getShipmentTool
  },
  stockTransfer: {
    create: createStockTransfer,
    setStatus: setStockTransferStatus,
    lines: { update: updateStockTransferLines },
    line: {
      pick: pickStockTransferLine,
      unpick: unpickStockTransferLine,
      pickEntity: pickStockTransferLineEntity
    },
    delete: deleteStockTransferTool,
    get: getStockTransferTool
  },
  warehouseTransfer: {
    setStatus: setWarehouseTransferStatus,
    line: {
      create: createWarehouseTransferLine,
      update: updateWarehouseTransferLine,
      delete: removeWarehouseTransferLine
    },
    delete: deleteWarehouseTransferTool,
    get: getWarehouseTransferTool,
    insert: insertWarehouseTransferTool,
    update: updateWarehouseTransferTool
  },
  batchProperty: {
    delete: deleteBatchPropertyTool,
    upsert: upsertBatchPropertyTool
  },
  receiptLine: {
    delete: deleteReceiptLineTool
  },
  shipmentLine: {
    delete: deleteShipmentLineTool
  },
  shippingMethod: {
    delete: deleteShippingMethodTool,
    get: getShippingMethodTool,
    create: upsertShippingMethodCreateTool,
    update: upsertShippingMethodUpdateTool
  },
  stockTransferLine: {
    delete: deleteStockTransferLineTool,
    create: upsertStockTransferLineCreateTool,
    update: upsertStockTransferLineUpdateTool
  },
  itemLedgerActivity: {
    get: getItemLedgerActivityTool
  },
  itemLedgerBalance: {
    get: getItemLedgerBalanceTool
  },
  batchProperties: {
    get: getBatchPropertiesTool
  },
  inventoryItems: {
    get: getInventoryItemsTool
  },
  inventoryValuation: {
    get: getInventoryValuationTool
  },
  inventoryValuationTieOut: {
    get: getInventoryValuationTieOutTool
  },
  inventoryReconciliationJournal: {
    create: createInventoryReconciliationJournalTool
  },
  kanbans: {
    get: getKanbansTool
  },
  kanbanProjectedQuantities: {
    get: getKanbanProjectedQuantitiesTool
  },
  stockTransferLines: {
    get: getStockTransferLinesTool
  },
  stockTransfers: {
    get: getStockTransfersTool
  },
  receipts: {
    get: getReceiptsTool
  },
  receiptLines: {
    get: getReceiptLinesTool
  },
  receiptRelatedItems: {
    get: getReceiptRelatedItemsTool
  },
  receiptTracking: {
    get: getReceiptTrackingTool
  },
  receiptFiles: {
    get: getReceiptFilesTool
  },
  serialNumbersForItem: {
    get: getSerialNumbersForItemTool
  },
  availableTrackedEntities: {
    get: getAvailableTrackedEntitiesTool
  },
  pickOrder: {
    get: getPickOrderTool
  },
  batchNumbersForItem: {
    get: getBatchNumbersForItemTool
  },
  storageUnitsList: {
    get: getStorageUnitsListTool
  },
  storageUnitsListForLocation: {
    get: getStorageUnitsListForLocationTool
  },
  storageUnitsTreeForLocation: {
    get: getStorageUnitsTreeForLocationTool
  },
  effectiveWorkCenterId: {
    get: getEffectiveWorkCenterIdTool
  },
  storageUnitRoots: {
    get: getStorageUnitRootsTool
  },
  storageUnitChildren: {
    get: getStorageUnitChildrenTool
  },
  storageUnitSubtrees: {
    get: getStorageUnitSubtreesTool
  },
  storageUnitParentIdsWithChildren: {
    get: getStorageUnitParentIdsWithChildrenTool
  },
  storageUnitsWithAncestors: {
    search: searchStorageUnitsWithAncestorsTool
  },
  stockMovements: {
    get: getStockMovementsTool
  },
  shipments: {
    get: getShipmentsTool
  },
  shipmentLines: {
    get: getShipmentLinesTool
  },
  shipmentRelatedItems: {
    get: getShipmentRelatedItemsTool
  },
  shipmentTracking: {
    get: getShipmentTrackingTool
  },
  rentalShipmentLines: {
    get: getRentalShipmentLinesTool
  },
  rentalReceiptLines: {
    get: getRentalReceiptLinesTool
  },
  shippingMethods: {
    get: getShippingMethodsTool
  },
  shippingMethodsList: {
    get: getShippingMethodsListTool
  },
  shippingTermsList: {
    get: getShippingTermsListTool
  },
  trackedEntities: {
    get: getTrackedEntitiesTool
  },
  trackedEntitiesByMakeMethodId: {
    get: getTrackedEntitiesByMakeMethodIdTool
  },
  trackedEntity: {
    get: getTrackedEntityTool
  },
  trackedEntityExpiry: {
    update: updateTrackedEntityExpiryTool
  },
  warehouseTransfers: {
    get: getWarehouseTransfersTool
  },
  warehouseTransferRelatedItems: {
    get: getWarehouseTransferRelatedItemsTool
  },
  warehouseTransferLine: {
    get: getWarehouseTransferLineTool
  },
  warehouseTransferLines: {
    get: getWarehouseTransferLinesTool
  },
  stockMovementEffectiveQuantity: {
    get: getStockMovementEffectiveQuantityTool
  },
  stockMovement: {
    correct: correctStockMovementTool
  },
  inventoryCounts: {
    get: getInventoryCountsTool
  },
  inventoryCountLines: {
    get: getInventoryCountLinesTool
  },
  inventoryCountLineSummary: {
    get: getInventoryCountLineSummaryTool
  },
  inventoryCountMovements: {
    get: getInventoryCountMovementsTool
  },
  inventoryCountLine: {
    update: updateInventoryCountLineTool
  },
  inventoryCountStatus: {
    update: updateInventoryCountStatusTool
  },
  batchPropertyOrder: {
    update: updateBatchPropertyOrderTool
  },
  storageUnitDescendants: {
    get: getStorageUnitDescendantsTool
  },
  storageUnitIdsWithDescendants: {
    expand: expandStorageUnitIdsWithDescendantsTool
  },
  storageTypeUsage: {
    get: getStorageTypeUsageTool
  },
  storageTypeWithCascade: {
    delete: deleteStorageTypeWithCascadeTool
  },
  storageTypes: {
    get: getStorageTypesTool
  },
  storageType: {
    get: getStorageTypeTool,
    create: upsertStorageTypeCreateTool,
    update: upsertStorageTypeUpdateTool
  },
  storageTypesList: {
    get: getStorageTypesListTool
  },
  shelfLifeForItems: {
    get: getShelfLifeForItemsTool
  },
  trackedEntityExpirations: {
    get: getTrackedEntityExpirationsTool
  },
  pickingLists: {
    get: getPickingListsTool
  },
  picksByJobMaterial: {
    get: getPicksByJobMaterialTool
  },
  pickingListLines: {
    get: getPickingListLinesTool
  },
  pickingListRelatedItems: {
    get: getPickingListRelatedItemsTool
  },
  pickingListAvailability: {
    get: getPickingListAvailabilityTool
  },
  pickingListRecommendations: {
    get: getPickingListRecommendationsTool
  },
  pickingListLine: {
    get: getPickingListLineTool
  },
  pickingSchedule: {
    get: getPickingScheduleTool
  }
};
