// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  addItemPredecessor,
  copyMethod,
  createChangeNotice,
  createChangeNoticeForItem,
  createMethodVersion,
  createPart,
  createSupplierPart,
  decideChangeNoticeApproval,
  deleteMethodOperation,
  recalculateItemCost,
  renameService,
  setChangeNoticeStatus,
  setItemActive,
  setItemFields,
  setItemPostingGroup,
  setItemReadableId,
  setItemSourcing,
  setItemSupersession,
  setItemTrackingType,
  setMaterialProperties,
  syncOnshapeMethod,
  updateItemManufacturing,
  updateItemPlanning,
  updatePart,
  updateSupplierPart,
  updateTool
} from "./items.server";
import {
  activateMethodVersionTool,
  addChangeNoticeAffectedItemTool,
  assertMethodOperationIsDraftTool,
  createItemDocumentUploadUrlTool,
  createRevisionTool,
  deleteChangeNoticeActionTool,
  deleteChangeNoticeRequiredActionTool,
  deleteChangeNoticeTool,
  deleteChangeNoticeTypeTool,
  deleteConfigurationParameterGroupTool,
  deleteConfigurationParameterTool,
  deleteConfigurationRuleTool,
  deleteItemCustomerPartTool,
  deleteItemPostingGroupTool,
  deleteItemTool,
  deleteMaterialDimensionTool,
  deleteMaterialFinishTool,
  deleteMaterialFormTool,
  deleteMaterialGradeTool,
  deleteMaterialSubstanceTool,
  deleteMaterialTypeTool,
  deleteMethodMaterialTool,
  deleteMethodOperationParameterTool,
  deleteMethodOperationStepSlideTool,
  deleteMethodOperationStepTool,
  deleteMethodOperationToolTool,
  deleteSupplierPartTool,
  deleteUnitOfMeasureTool,
  duplicateMethodOperationStepTool,
  getBomHasShelfLifeManagedInputTool,
  getBomItemAttributesTool,
  getChangeNoticeActionsTool,
  getChangeNoticeAffectedItemsTool,
  getChangeNoticeDiffTool,
  getChangeNoticeRequiredActionsListTool,
  getChangeNoticeRequiredActionsTool,
  getChangeNoticeRequiredActionTool,
  getChangeNoticesForNonConformanceTool,
  getChangeNoticesTool,
  getChangeNoticeTool,
  getChangeNoticeTypesListTool,
  getChangeNoticeTypesTool,
  getChangeNoticeTypeTool,
  getConfigurationParametersTool,
  getConfigurationRulesTool,
  getConsumablesTool,
  getConsumableTool,
  getDemandForecastSourcesTool,
  getItemCostHistoryTool,
  getItemCostTool,
  getItemCustomerPartsTool,
  getItemCustomerPartTool,
  getItemDemandTool,
  getItemFilesTool,
  getItemManufacturingTool,
  getItemMpnsListTool,
  getItemPlanningTool,
  getItemPostingGroupsListTool,
  getItemPostingGroupsTool,
  getItemPostingGroupTool,
  getItemQuantitiesTool,
  getItemReplenishmentTool,
  getItemShelfLifeTool,
  getItemStockQuantitiesByLocationTool,
  getItemStorageUnitQuantitiesTool,
  getItemSupersessionsForItemsTool,
  getItemSupersessionTool,
  getItemTool,
  getItemUnitSalePriceTool,
  getMakeMethodByIdTool,
  getMakeMethodsTool,
  getMaterialDimensionListTool,
  getMaterialDimensionsTool,
  getMaterialDimensionTool,
  getMaterialFinishesTool,
  getMaterialFinishListTool,
  getMaterialFinishTool,
  getMaterialFormsListTool,
  getMaterialFormsTool,
  getMaterialFormTool,
  getMaterialGradeListTool,
  getMaterialGradesTool,
  getMaterialGradeTool,
  getMaterialSubstancesListTool,
  getMaterialSubstancesTool,
  getMaterialSubstanceTool,
  getMaterialsTool,
  getMaterialTool,
  getMaterialTypeListTool,
  getMaterialTypesTool,
  getMaterialTypeTool,
  getMaterialUsedInTool,
  getMethodMaterialsByMakeMethodTool,
  getMethodMaterialsTool,
  getMethodOperationsByMakeMethodIdTool,
  getMethodOperationsTool,
  getMethodTreeTool,
  getOpenJobMaterialsTool,
  getOpenProductionOrdersTool,
  getOpenPurchaseOrderLinesTool,
  getOpenSalesOrderLinesTool,
  getPartsListTool,
  getPartsTool,
  getPartTool,
  getPartUsedInTool,
  getPickMethodsTool,
  getPickMethodTool,
  getRecipeProcessIdsForItemTool,
  getServicesListTool,
  getServicesTool,
  getServiceTool,
  getSupersessionChainTool,
  getSupplierPartsBySupplierTool,
  getSupplierPartsTool,
  getSupplierPriceBreaksForItemsTool,
  getToolsTool,
  getToolTool,
  getUnitOfMeasuresListTool,
  getUnitOfMeasuresTool,
  getUnitOfMeasureTool,
  getUnitOfMeasureUsageTool,
  removeChangeNoticeAffectedItemTool,
  resolveItemIdFromExtractedTextTool,
  setChangeNoticeActionTasksTool,
  setMethodMaterialStepLinkTool,
  setMethodOperationToolStepLinkTool,
  updateChangeNoticeActionOrderTool,
  updateChangeNoticeActionStatusTool,
  updateChangeNoticeAffectedItemChangeTypeTool,
  updateChangeNoticeAffectedItemCutoverTool,
  updateChangeNoticeTool,
  updateConfigurationParameterGroupOrderTool,
  updateConfigurationParameterOrderTool,
  updateDefaultRevisionTool,
  updateItemCostTool,
  updateItemTool,
  updateMaterialOrderTool,
  updateOperationOrderTool,
  updateRevisionTool,
  upsertChangeNoticeRequiredActionTool,
  upsertChangeNoticeTypeCreateTool,
  upsertChangeNoticeTypeUpdateTool,
  upsertConfigurationParameterGroupTool,
  upsertConfigurationParameterTool,
  upsertConfigurationRuleTool,
  upsertConsumableCreateTool,
  upsertConsumableUpdateTool,
  upsertItemCostTool,
  upsertItemCustomerPartTool,
  upsertItemPostingGroupCreateTool,
  upsertItemPostingGroupUpdateTool,
  upsertItemPurchasingTool,
  upsertItemUnitSalePriceTool,
  upsertMaterialCreateTool,
  upsertMaterialDimensionTool,
  upsertMaterialFinishTool,
  upsertMaterialFormCreateTool,
  upsertMaterialFormUpdateTool,
  upsertMaterialGradeTool,
  upsertMaterialSubstanceCreateTool,
  upsertMaterialSubstanceUpdateTool,
  upsertMaterialTypeTool,
  upsertMaterialUpdateTool,
  upsertMethodMaterialCreateTool,
  upsertMethodMaterialUpdateTool,
  upsertMethodOperationCreateTool,
  upsertMethodOperationParameterCreateTool,
  upsertMethodOperationParameterUpdateTool,
  upsertMethodOperationStepCreateTool,
  upsertMethodOperationStepSlideCreateTool,
  upsertMethodOperationStepSlideUpdateTool,
  upsertMethodOperationStepUpdateTool,
  upsertMethodOperationToolCreateTool,
  upsertMethodOperationToolUpdateTool,
  upsertMethodOperationUpdateTool,
  upsertPickMethodCreateTool,
  upsertPickMethodUpdateTool,
  upsertPickMethodWithShelfLifeTool,
  upsertServiceCreateTool,
  upsertServiceUpdateTool,
  upsertToolCreateTool,
  upsertUnitOfMeasureCreateTool,
  upsertUnitOfMeasureUpdateTool
} from "./items.tools.server";

/** The items module's operations, by entity. */
export const items = {
  item: {
    setTrackingType: setItemTrackingType,
    setFields: setItemFields,
    setSourcing: setItemSourcing,
    setActive: setItemActive,
    setPostingGroup: setItemPostingGroup,
    setReadableId: setItemReadableId,
    delete: deleteItemTool,
    get: getItemTool,
    update: updateItemTool
  },
  part: {
    create: createPart,
    update: updatePart,
    get: getPartTool
  },
  tool: {
    update: updateTool,
    get: getToolTool,
    create: upsertToolCreateTool
  },
  material: {
    setProperties: setMaterialProperties,
    get: getMaterialTool,
    create: upsertMaterialCreateTool,
    update: upsertMaterialUpdateTool
  },
  service: {
    rename: renameService,
    get: getServiceTool,
    create: upsertServiceCreateTool,
    update: upsertServiceUpdateTool
  },
  manufacturing: { update: updateItemManufacturing },
  planning: { update: updateItemPlanning },
  supersession: {
    set: setItemSupersession,
    addPredecessor: addItemPredecessor
  },
  supplierPart: {
    create: createSupplierPart,
    update: updateSupplierPart,
    delete: deleteSupplierPartTool
  },
  cost: { recalculate: recalculateItemCost },
  method: {
    copy: copyMethod,
    createVersion: createMethodVersion,
    syncOnshape: syncOnshapeMethod
  },
  methodOperation: {
    delete: deleteMethodOperation,
    create: upsertMethodOperationCreateTool,
    update: upsertMethodOperationUpdateTool
  },
  changeNotice: {
    create: createChangeNotice,
    createForItem: createChangeNoticeForItem,
    setStatus: setChangeNoticeStatus,
    decideApproval: decideChangeNoticeApproval,
    get: getChangeNoticeTool,
    update: updateChangeNoticeTool,
    delete: deleteChangeNoticeTool
  },
  methodVersion: {
    activate: activateMethodVersionTool
  },
  revision: {
    create: createRevisionTool,
    update: updateRevisionTool
  },
  configurationParameter: {
    delete: deleteConfigurationParameterTool,
    upsert: upsertConfigurationParameterTool
  },
  configurationRule: {
    delete: deleteConfigurationRuleTool,
    upsert: upsertConfigurationRuleTool
  },
  itemCustomerPart: {
    delete: deleteItemCustomerPartTool,
    get: getItemCustomerPartTool,
    upsert: upsertItemCustomerPartTool
  },
  configurationParameterGroup: {
    delete: deleteConfigurationParameterGroupTool,
    upsert: upsertConfigurationParameterGroupTool
  },
  itemPostingGroup: {
    delete: deleteItemPostingGroupTool,
    get: getItemPostingGroupTool,
    create: upsertItemPostingGroupCreateTool,
    update: upsertItemPostingGroupUpdateTool
  },
  materialDimension: {
    delete: deleteMaterialDimensionTool,
    get: getMaterialDimensionTool,
    upsert: upsertMaterialDimensionTool
  },
  materialFinish: {
    delete: deleteMaterialFinishTool,
    get: getMaterialFinishTool,
    upsert: upsertMaterialFinishTool
  },
  materialForm: {
    delete: deleteMaterialFormTool,
    get: getMaterialFormTool,
    create: upsertMaterialFormCreateTool,
    update: upsertMaterialFormUpdateTool
  },
  materialGrade: {
    delete: deleteMaterialGradeTool,
    get: getMaterialGradeTool,
    upsert: upsertMaterialGradeTool
  },
  materialSubstance: {
    delete: deleteMaterialSubstanceTool,
    get: getMaterialSubstanceTool,
    create: upsertMaterialSubstanceCreateTool,
    update: upsertMaterialSubstanceUpdateTool
  },
  methodMaterial: {
    delete: deleteMethodMaterialTool,
    create: upsertMethodMaterialCreateTool,
    update: upsertMethodMaterialUpdateTool
  },
  methodOperationIsDraft: {
    assert: assertMethodOperationIsDraftTool
  },
  methodOperationStep: {
    delete: deleteMethodOperationStepTool,
    create: upsertMethodOperationStepCreateTool,
    update: upsertMethodOperationStepUpdateTool,
    duplicate: duplicateMethodOperationStepTool
  },
  methodOperationStepSlide: {
    delete: deleteMethodOperationStepSlideTool,
    create: upsertMethodOperationStepSlideCreateTool,
    update: upsertMethodOperationStepSlideUpdateTool
  },
  methodOperationParameter: {
    delete: deleteMethodOperationParameterTool,
    create: upsertMethodOperationParameterCreateTool,
    update: upsertMethodOperationParameterUpdateTool
  },
  methodOperationTool: {
    delete: deleteMethodOperationToolTool,
    create: upsertMethodOperationToolCreateTool,
    update: upsertMethodOperationToolUpdateTool
  },
  unitOfMeasure: {
    delete: deleteUnitOfMeasureTool,
    get: getUnitOfMeasureTool,
    create: upsertUnitOfMeasureCreateTool,
    update: upsertUnitOfMeasureUpdateTool
  },
  configurationParameters: {
    get: getConfigurationParametersTool
  },
  configurationRules: {
    get: getConfigurationRulesTool
  },
  consumable: {
    get: getConsumableTool,
    create: upsertConsumableCreateTool,
    update: upsertConsumableUpdateTool
  },
  consumables: {
    get: getConsumablesTool
  },
  itemCost: {
    get: getItemCostTool,
    update: updateItemCostTool,
    upsert: upsertItemCostTool
  },
  itemCostHistory: {
    get: getItemCostHistoryTool
  },
  itemCustomerParts: {
    get: getItemCustomerPartsTool
  },
  itemDemand: {
    get: getItemDemandTool
  },
  demandForecastSources: {
    get: getDemandForecastSourcesTool
  },
  itemFiles: {
    get: getItemFilesTool
  },
  itemPostingGroups: {
    get: getItemPostingGroupsTool
  },
  itemPostingGroupsList: {
    get: getItemPostingGroupsListTool
  },
  itemManufacturing: {
    get: getItemManufacturingTool
  },
  itemPlanning: {
    get: getItemPlanningTool
  },
  itemQuantities: {
    get: getItemQuantitiesTool
  },
  itemStockQuantitiesByLocation: {
    get: getItemStockQuantitiesByLocationTool
  },
  itemReplenishment: {
    get: getItemReplenishmentTool
  },
  itemSupersession: {
    get: getItemSupersessionTool
  },
  itemSupersessionsForItems: {
    get: getItemSupersessionsForItemsTool
  },
  supersessionChain: {
    get: getSupersessionChainTool
  },
  itemStorageUnitQuantities: {
    get: getItemStorageUnitQuantitiesTool
  },
  itemUnitSalePrice: {
    get: getItemUnitSalePriceTool,
    upsert: upsertItemUnitSalePriceTool
  },
  materialUsedIn: {
    get: getMaterialUsedInTool
  },
  makeMethods: {
    get: getMakeMethodsTool
  },
  makeMethodById: {
    get: getMakeMethodByIdTool
  },
  materials: {
    get: getMaterialsTool
  },
  materialDimensions: {
    get: getMaterialDimensionsTool
  },
  materialDimensionList: {
    get: getMaterialDimensionListTool
  },
  materialFinishes: {
    get: getMaterialFinishesTool
  },
  materialFinishList: {
    get: getMaterialFinishListTool
  },
  materialForms: {
    get: getMaterialFormsTool
  },
  materialFormsList: {
    get: getMaterialFormsListTool
  },
  materialGrades: {
    get: getMaterialGradesTool
  },
  materialGradeList: {
    get: getMaterialGradeListTool
  },
  materialSubstances: {
    get: getMaterialSubstancesTool
  },
  materialSubstancesList: {
    get: getMaterialSubstancesListTool
  },
  methodMaterials: {
    get: getMethodMaterialsTool
  },
  methodMaterialsByMakeMethod: {
    get: getMethodMaterialsByMakeMethodTool
  },
  methodOperations: {
    get: getMethodOperationsTool
  },
  methodOperationsByMakeMethodId: {
    get: getMethodOperationsByMakeMethodIdTool
  },
  methodTree: {
    get: getMethodTreeTool
  },
  bomItemAttributes: {
    get: getBomItemAttributesTool
  },
  openJobMaterials: {
    get: getOpenJobMaterialsTool
  },
  openProductionOrders: {
    get: getOpenProductionOrdersTool
  },
  openPurchaseOrderLines: {
    get: getOpenPurchaseOrderLinesTool
  },
  openSalesOrderLines: {
    get: getOpenSalesOrderLinesTool
  },
  parts: {
    get: getPartsTool
  },
  itemMpnsList: {
    get: getItemMpnsListTool
  },
  partsList: {
    get: getPartsListTool
  },
  partUsedIn: {
    get: getPartUsedInTool
  },
  pickMethod: {
    get: getPickMethodTool,
    create: upsertPickMethodCreateTool,
    update: upsertPickMethodUpdateTool
  },
  pickMethods: {
    get: getPickMethodsTool
  },
  services: {
    get: getServicesTool
  },
  servicesList: {
    get: getServicesListTool
  },
  supplierParts: {
    get: getSupplierPartsTool
  },
  supplierPartsBySupplier: {
    get: getSupplierPartsBySupplierTool
  },
  tools: {
    get: getToolsTool
  },
  unitOfMeasureUsage: {
    get: getUnitOfMeasureUsageTool
  },
  unitOfMeasures: {
    get: getUnitOfMeasuresTool
  },
  unitOfMeasuresList: {
    get: getUnitOfMeasuresListTool
  },
  configurationParameterGroupOrder: {
    update: updateConfigurationParameterGroupOrderTool
  },
  defaultRevision: {
    update: updateDefaultRevisionTool
  },
  configurationParameterOrder: {
    update: updateConfigurationParameterOrderTool
  },
  materialOrder: {
    update: updateMaterialOrderTool
  },
  operationOrder: {
    update: updateOperationOrderTool
  },
  recipeProcessIdsForItem: {
    get: getRecipeProcessIdsForItemTool
  },
  itemShelfLife: {
    get: getItemShelfLifeTool
  },
  bomHasShelfLifeManagedInput: {
    get: getBomHasShelfLifeManagedInputTool
  },
  pickMethodWithShelfLife: {
    upsert: upsertPickMethodWithShelfLifeTool
  },
  itemIdFromExtractedText: {
    resolve: resolveItemIdFromExtractedTextTool
  },
  itemPurchasing: {
    upsert: upsertItemPurchasingTool
  },
  methodMaterialStepLink: {
    set: setMethodMaterialStepLinkTool
  },
  methodOperationToolStepLink: {
    set: setMethodOperationToolStepLinkTool
  },
  materialType: {
    delete: deleteMaterialTypeTool,
    get: getMaterialTypeTool,
    upsert: upsertMaterialTypeTool
  },
  materialTypes: {
    get: getMaterialTypesTool
  },
  materialTypeList: {
    get: getMaterialTypeListTool
  },
  supplierPriceBreaksForItems: {
    get: getSupplierPriceBreaksForItemsTool
  },
  changeNotices: {
    get: getChangeNoticesTool
  },
  changeNoticeTypes: {
    get: getChangeNoticeTypesTool
  },
  changeNoticeTypesList: {
    get: getChangeNoticeTypesListTool
  },
  changeNoticeType: {
    get: getChangeNoticeTypeTool,
    create: upsertChangeNoticeTypeCreateTool,
    update: upsertChangeNoticeTypeUpdateTool,
    delete: deleteChangeNoticeTypeTool
  },
  changeNoticeAffectedItem: {
    add: addChangeNoticeAffectedItemTool,
    remove: removeChangeNoticeAffectedItemTool
  },
  changeNoticeAffectedItemChangeType: {
    update: updateChangeNoticeAffectedItemChangeTypeTool
  },
  changeNoticeAffectedItemCutover: {
    update: updateChangeNoticeAffectedItemCutoverTool
  },
  changeNoticeAffectedItems: {
    get: getChangeNoticeAffectedItemsTool
  },
  changeNoticesForNonConformance: {
    get: getChangeNoticesForNonConformanceTool
  },
  changeNoticeActions: {
    get: getChangeNoticeActionsTool
  },
  changeNoticeActionStatus: {
    update: updateChangeNoticeActionStatusTool
  },
  changeNoticeAction: {
    delete: deleteChangeNoticeActionTool
  },
  changeNoticeActionOrder: {
    update: updateChangeNoticeActionOrderTool
  },
  changeNoticeRequiredActions: {
    get: getChangeNoticeRequiredActionsTool
  },
  changeNoticeRequiredActionsList: {
    get: getChangeNoticeRequiredActionsListTool
  },
  changeNoticeRequiredAction: {
    get: getChangeNoticeRequiredActionTool,
    upsert: upsertChangeNoticeRequiredActionTool,
    delete: deleteChangeNoticeRequiredActionTool
  },
  changeNoticeActionTasks: {
    set: setChangeNoticeActionTasksTool
  },
  changeNoticeDiff: {
    get: getChangeNoticeDiffTool
  },
  itemDocumentUploadUrl: {
    create: createItemDocumentUploadUrlTool
  }
};
