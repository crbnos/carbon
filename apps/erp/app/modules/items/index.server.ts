// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  addItemPredecessor,
  copyMethod,
  createMethodVersion,
  createPart,
  createSupplierPart,
  deleteMethodOperation,
  recalculateItemCost,
  renameService,
  setItemActive,
  setItemFields,
  setItemPostingGroup,
  setItemReadableId,
  setItemSourcing,
  setItemSupersession,
  setItemTrackingType,
  setMaterialProperties,
  updateItemManufacturing,
  updateItemPlanning,
  updatePart,
  updateSupplierPart,
  updateTool
} from "./items.server";

/** The items module's operations, by entity. */
export const items = {
  item: {
    setTrackingType: setItemTrackingType,
    setFields: setItemFields,
    setSourcing: setItemSourcing,
    setActive: setItemActive,
    setPostingGroup: setItemPostingGroup,
    setReadableId: setItemReadableId
  },
  part: { create: createPart, update: updatePart },
  tool: { update: updateTool },
  material: { setProperties: setMaterialProperties },
  service: { rename: renameService },
  manufacturing: { update: updateItemManufacturing },
  planning: { update: updateItemPlanning },
  supersession: {
    set: setItemSupersession,
    addPredecessor: addItemPredecessor
  },
  supplierPart: { create: createSupplierPart, update: updateSupplierPart },
  cost: { recalculate: recalculateItemCost },
  method: { copy: copyMethod, createVersion: createMethodVersion },
  methodOperation: { delete: deleteMethodOperation }
};
