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
  pickStockTransferLine,
  pickStockTransferLineEntity,
  postInventoryCount,
  postReceipt,
  postShipment,
  removeReceiptReturnEntity,
  removeStorageUnit,
  removeWarehouseTransferLine,
  scanKanban,
  setReceiptLineBatch,
  setReceiptLineSerial,
  setStockTransferStatus,
  setWarehouseTransferStatus,
  splitReceiptLine,
  splitShipmentLine,
  unpickStockTransferLine,
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

/** The inventory module's operations, by entity. */
export const inventory = {
  item: { adjust: adjustInventory },
  kanban: { scan: scanKanban },
  inventoryCount: { create: createInventoryCount, post: postInventoryCount },
  storageUnit: { delete: removeStorageUnit },
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
    fixedAssetLine: { update: updateReceiptFixedAssetLine }
  },
  shipment: {
    create: createShipment,
    update: updateShipment,
    post: postShipment,
    void: voidShipment,
    lines: { update: updateShipmentLines },
    line: { split: splitShipmentLine, assignEntity: assignShipmentLineEntity },
    fixedAssetLine: { update: updateShipmentFixedAssetLine }
  },
  stockTransfer: {
    create: createStockTransfer,
    setStatus: setStockTransferStatus,
    lines: { update: updateStockTransferLines },
    line: {
      pick: pickStockTransferLine,
      unpick: unpickStockTransferLine,
      pickEntity: pickStockTransferLineEntity
    }
  },
  warehouseTransfer: {
    setStatus: setWarehouseTransferStatus,
    line: {
      create: createWarehouseTransferLine,
      update: updateWarehouseTransferLine,
      delete: removeWarehouseTransferLine
    }
  }
};
