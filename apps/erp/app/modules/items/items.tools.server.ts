// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The items module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in items.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import {
  envelope,
  envelopes,
  paged,
  plain,
  stamp
} from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  activateMethodVersion,
  addChangeNoticeAffectedItem,
  assertMethodOperationIsDraft,
  createItemDocumentUploadUrl,
  createRevision,
  deleteChangeNotice,
  deleteChangeNoticeAction,
  deleteChangeNoticeRequiredAction,
  deleteChangeNoticeType,
  deleteConfigurationParameter,
  deleteConfigurationParameterGroup,
  deleteConfigurationRule,
  deleteItem,
  deleteItemCustomerPart,
  deleteItemPostingGroup,
  deleteMaterialDimension,
  deleteMaterialFinish,
  deleteMaterialForm,
  deleteMaterialGrade,
  deleteMaterialSubstance,
  deleteMaterialType,
  deleteMethodMaterial,
  deleteMethodOperationParameter,
  deleteMethodOperationStep,
  deleteMethodOperationStepSlide,
  deleteMethodOperationTool,
  deleteSupplierPart,
  deleteUnitOfMeasure,
  duplicateMethodOperationStep,
  getBomHasShelfLifeManagedInput,
  getBomItemAttributes,
  getChangeNotice,
  getChangeNoticeActions,
  getChangeNoticeAffectedItems,
  getChangeNoticeDiff,
  getChangeNoticeRequiredAction,
  getChangeNoticeRequiredActions,
  getChangeNoticeRequiredActionsList,
  getChangeNotices,
  getChangeNoticesForNonConformance,
  getChangeNoticeType,
  getChangeNoticeTypes,
  getChangeNoticeTypesList,
  getConfigurationRules,
  getConsumable,
  getConsumables,
  getDemandForecastSources,
  getItem,
  getItemCost,
  getItemCostHistory,
  getItemCustomerPart,
  getItemCustomerParts,
  getItemDemand,
  getItemFiles,
  getItemManufacturing,
  getItemMpnsList,
  getItemPlanning,
  getItemPostingGroup,
  getItemPostingGroups,
  getItemPostingGroupsList,
  getItemQuantities,
  getItemReplenishment,
  getItemShelfLife,
  getItemStockQuantitiesByLocation,
  getItemSupersession,
  getItemSupersessionsForItems,
  getItemUnitSalePrice,
  getMakeMethodById,
  getMakeMethods,
  getMaterial,
  getMaterialDimension,
  getMaterialDimensionList,
  getMaterialDimensions,
  getMaterialFinish,
  getMaterialFinishes,
  getMaterialFinishList,
  getMaterialForm,
  getMaterialForms,
  getMaterialFormsList,
  getMaterialGrade,
  getMaterialGradeList,
  getMaterialGrades,
  getMaterialSubstance,
  getMaterialSubstances,
  getMaterialSubstancesList,
  getMaterials,
  getMaterialType,
  getMaterialTypeList,
  getMaterialTypes,
  getMaterialUsedIn,
  getMethodMaterials,
  getMethodMaterialsByMakeMethod,
  getMethodOperations,
  getMethodOperationsByMakeMethodId,
  getMethodTree,
  getOpenJobMaterials,
  getOpenProductionOrders,
  getOpenPurchaseOrderLines,
  getOpenSalesOrderLines,
  getPart,
  getParts,
  getPartsList,
  getPartUsedIn,
  getPickMethod,
  getPickMethods,
  getRecipeProcessIdsForItem,
  getService,
  getServices,
  getServicesList,
  getSupersessionChain,
  getSupplierParts,
  getSupplierPartsBySupplier,
  getTool,
  getTools,
  getUnitOfMeasure,
  getUnitOfMeasures,
  getUnitOfMeasuresList,
  getUnitOfMeasureUsage,
  removeChangeNoticeAffectedItem,
  resolveItemIdFromExtractedText,
  setChangeNoticeActionTasks,
  setMethodMaterialStepLink,
  setMethodOperationToolStepLink,
  updateChangeNotice,
  updateChangeNoticeActionOrder,
  updateChangeNoticeActionStatus,
  updateChangeNoticeAffectedItemChangeType,
  updateChangeNoticeAffectedItemCutover,
  updateConfigurationParameterGroupOrder,
  updateConfigurationParameterOrder,
  updateDefaultRevision,
  updateItem,
  updateItemCost,
  updateMaterialOrder,
  updateOperationOrder,
  updateRevision,
  upsertChangeNoticeRequiredAction,
  upsertChangeNoticeType,
  upsertConfigurationParameter,
  upsertConfigurationParameterGroup,
  upsertConfigurationRule,
  upsertConsumable,
  upsertItemCost,
  upsertItemCustomerPart,
  upsertItemPostingGroup,
  upsertItemPurchasing,
  upsertItemUnitSalePrice,
  upsertMaterial,
  upsertMaterialDimension,
  upsertMaterialFinish,
  upsertMaterialForm,
  upsertMaterialGrade,
  upsertMaterialSubstance,
  upsertMaterialType,
  upsertMethodMaterial,
  upsertMethodOperation,
  upsertMethodOperationParameter,
  upsertMethodOperationStep,
  upsertMethodOperationStepSlide,
  upsertMethodOperationTool,
  upsertPickMethod,
  upsertPickMethodWithShelfLife,
  upsertService,
  upsertTool,
  upsertUnitOfMeasure
} from "./items.service";
import {
  getConfigurationParameters,
  getItemStorageUnitQuantities,
  getSupplierPriceBreaksForItems
} from "./items.utils";

/**
 * Activate method version
 *
 * @mcp
 */
export const activateMethodVersionTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await activateMethodVersion(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Create revision
 *
 * @mcp
 */
export const createRevisionTool = defineServiceFn({
  input: z.looseObject({
    item: z.looseObject({
      companyId: z.string().nullable(),
      id: z.string(),
      name: z.string(),
      type: z.enum([
        "Part",
        "Service",
        "Material",
        "Tool",
        "Fixture",
        "Consumable"
      ]),
      modelUploadId: z.string().nullable(),
      description: z.string().nullable(),
      unitOfMeasureCode: z.string().nullable(),
      readableId: z.string(),
      defaultMethodType: z
        .enum(["Purchase to Order", "Pull from Inventory", "Make to Order"])
        .nullable(),
      itemTrackingType: z.enum([
        "Inventory",
        "Non-Inventory",
        "Serial",
        "Batch"
      ]),
      mpn: z.string().nullable(),
      replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
      sourcingType: z.enum(["Specified", "Drop Ship", "Ship from Inventory"]),
      thumbnailPath: z.string().nullable()
    }),
    revision: z.string(),
    active: z.boolean().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createRevision(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Delete configuration parameter
 *
 * @mcp destructive
 */
export const deleteConfigurationParameterTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteConfigurationParameter(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete configuration rule
 *
 * @mcp destructive
 */
export const deleteConfigurationRuleTool = defineServiceFn({
  input: z.looseObject({ field: z.string(), itemId: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteConfigurationRule(
        ctx.asCaller.supabase,
        input.field as never,
        input.itemId as never
      )
    );
  }
});

/**
 * Delete item customer part
 *
 * @mcp destructive
 */
export const deleteItemCustomerPartTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteItemCustomerPart(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete supplier part
 *
 * @mcp destructive
 */
export const deleteSupplierPartTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSupplierPart(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete configuration parameter group
 *
 * @mcp destructive
 */
export const deleteConfigurationParameterGroupTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteConfigurationParameterGroup(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete item
 *
 * @mcp destructive
 */
export const deleteItemTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteItem(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete item posting group
 *
 * @mcp destructive
 */
export const deleteItemPostingGroupTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteItemPostingGroup(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete material dimension
 *
 * @mcp destructive
 */
export const deleteMaterialDimensionTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMaterialDimension(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete material finish
 *
 * @mcp destructive
 */
export const deleteMaterialFinishTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMaterialFinish(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete material form
 *
 * @mcp destructive
 */
export const deleteMaterialFormTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMaterialForm(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete material grade
 *
 * @mcp destructive
 */
export const deleteMaterialGradeTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMaterialGrade(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete material substance
 *
 * @mcp destructive
 */
export const deleteMaterialSubstanceTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMaterialSubstance(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete method material
 *
 * @mcp destructive
 */
export const deleteMethodMaterialTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMethodMaterial(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Assert method operation is draft
 *
 * @mcp
 */
export const assertMethodOperationIsDraftTool = defineServiceFn({
  input: z.looseObject({ operationId: z.string() }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await assertMethodOperationIsDraft(
        ctx.asCaller.supabase,
        input.operationId as never
      )
    );
  }
});

/**
 * Delete method operation step
 *
 * @mcp destructive
 */
export const deleteMethodOperationStepTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMethodOperationStep(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete method operation step slide
 *
 * @mcp destructive
 */
export const deleteMethodOperationStepSlideTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMethodOperationStepSlide(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete method operation parameter
 *
 * @mcp destructive
 */
export const deleteMethodOperationParameterTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMethodOperationParameter(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete method operation tool
 *
 * @mcp destructive
 */
export const deleteMethodOperationToolTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMethodOperationTool(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete unit of measure
 *
 * @mcp destructive
 */
export const deleteUnitOfMeasureTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteUnitOfMeasure(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get configuration parameters
 *
 * @mcp read
 */
export const getConfigurationParametersTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getConfigurationParameters(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get configuration rules
 *
 * @mcp read
 */
export const getConfigurationRulesTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getConfigurationRules(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get consumable
 *
 * @mcp read
 */
export const getConsumableTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getConsumable(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get consumables
 *
 * @mcp read
 */
export const getConsumablesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getConsumables(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get item
 *
 * @mcp read
 */
export const getItemTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItem(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get item cost
 *
 * @mcp read
 */
export const getItemCostTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemCost(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item cost history
 *
 * @mcp read
 */
export const getItemCostHistoryTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemCostHistory(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item customer part
 *
 * @mcp read
 */
export const getItemCustomerPartTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemCustomerPart(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item customer parts
 *
 * @mcp read
 */
export const getItemCustomerPartsTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemCustomerParts(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item demand
 *
 * @mcp read
 */
export const getItemDemandTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    periods: z.array(z.string())
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemDemand(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get demand forecast sources
 *
 * @mcp read
 */
export const getDemandForecastSourcesTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    periods: z.array(z.string())
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getDemandForecastSources(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get item files
 *
 * @mcp read
 */
export const getItemFilesTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getItemFiles(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item posting group
 *
 * @mcp read
 */
export const getItemPostingGroupTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemPostingGroup(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get item posting groups
 *
 * @mcp read
 */
export const getItemPostingGroupsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getItemPostingGroups(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get item posting groups list
 *
 * @mcp read
 */
export const getItemPostingGroupsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return envelope(
      ctx,
      await getItemPostingGroupsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get item manufacturing
 *
 * @mcp read
 */
export const getItemManufacturingTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemManufacturing(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item planning
 *
 * @mcp read
 */
export const getItemPlanningTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemPlanning(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get item quantities
 *
 * @mcp read
 */
export const getItemQuantitiesTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemQuantities(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * On-hand quantity per item for the Item picker's badge, as a plain map
 *
 * @mcp read
 */
export const getItemStockQuantitiesByLocationTool = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemStockQuantitiesByLocation(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get item replenishment
 *
 * @mcp read
 */
export const getItemReplenishmentTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemReplenishment(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item supersession
 *
 * @mcp read
 */
export const getItemSupersessionTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemSupersession(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item supersessions for items
 *
 * @mcp read
 */
export const getItemSupersessionsForItemsTool = defineServiceFn({
  input: z.looseObject({ itemIds: z.array(z.string()) }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemSupersessionsForItems(
        ctx.asCaller.supabase,
        stamp(ctx, input.itemIds, ["companyId"]) as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get supersession chain
 *
 * @mcp read
 */
export const getSupersessionChainTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getSupersessionChain(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item storage unit quantities
 *
 * @mcp read
 */
export const getItemStorageUnitQuantitiesTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemStorageUnitQuantities(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get item unit sale price
 *
 * @mcp read
 */
export const getItemUnitSalePriceTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemUnitSalePrice(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Where a material or consumable is used
 *
 * @mcp read
 */
export const getMaterialUsedInTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getMaterialUsedIn(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get make methods
 *
 * @mcp read
 */
export const getMakeMethodsTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMakeMethods(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get make method by id
 *
 * @mcp read
 */
export const getMakeMethodByIdTool = defineServiceFn({
  input: z.looseObject({ makeMethodId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMakeMethodById(
        ctx.asCaller.supabase,
        input.makeMethodId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get material
 *
 * @mcp read
 */
export const getMaterialTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaterial(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get materials
 *
 * @mcp read
 */
export const getMaterialsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getMaterials(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get material dimension
 *
 * @mcp read
 */
export const getMaterialDimensionTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaterialDimension(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get material dimensions
 *
 * @mcp read
 */
export const getMaterialDimensionsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    isMetric: z.boolean()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getMaterialDimensions(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get material dimension list
 *
 * @mcp read
 */
export const getMaterialDimensionListTool = defineServiceFn({
  input: z.looseObject({ materialFormId: z.string(), isMetric: z.boolean() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaterialDimensionList(
        ctx.asCaller.supabase,
        input.materialFormId as never,
        input.isMetric as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get material finish
 *
 * @mcp read
 */
export const getMaterialFinishTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaterialFinish(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get material finishes
 *
 * @mcp read
 */
export const getMaterialFinishesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getMaterialFinishes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get material finish list
 *
 * @mcp read
 */
export const getMaterialFinishListTool = defineServiceFn({
  input: z.looseObject({ materialSubstanceId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaterialFinishList(
        ctx.asCaller.supabase,
        input.materialSubstanceId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get material form
 *
 * @mcp read
 */
export const getMaterialFormTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaterialForm(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get material forms
 *
 * @mcp read
 */
export const getMaterialFormsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getMaterialForms(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get material forms list
 *
 * @mcp read
 */
export const getMaterialFormsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return envelope(
      ctx,
      await getMaterialFormsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get material grades
 *
 * @mcp read
 */
export const getMaterialGradesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getMaterialGrades(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get material grade
 *
 * @mcp read
 */
export const getMaterialGradeTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaterialGrade(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get material grade list
 *
 * @mcp read
 */
export const getMaterialGradeListTool = defineServiceFn({
  input: z.looseObject({ materialSubstanceId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaterialGradeList(
        ctx.asCaller.supabase,
        input.materialSubstanceId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get material substance
 *
 * @mcp read
 */
export const getMaterialSubstanceTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaterialSubstance(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get material substances
 *
 * @mcp read
 */
export const getMaterialSubstancesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getMaterialSubstances(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get material substances list
 *
 * @mcp read
 */
export const getMaterialSubstancesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return envelope(
      ctx,
      await getMaterialSubstancesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get method materials
 *
 * @mcp read
 */
export const getMethodMaterialsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getMethodMaterials(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get method materials by make method
 *
 * @mcp read
 */
export const getMethodMaterialsByMakeMethodTool = defineServiceFn({
  input: z.looseObject({ makeMethodId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMethodMaterialsByMakeMethod(
        ctx.asCaller.supabase,
        input.makeMethodId as never
      )
    );
  }
});

/**
 * Get method operations
 *
 * @mcp read
 */
export const getMethodOperationsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getMethodOperations(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get method operations by make method id
 *
 * @mcp read
 */
export const getMethodOperationsByMakeMethodIdTool = defineServiceFn({
  input: z.looseObject({ makeMethodId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMethodOperationsByMakeMethodId(
        ctx.asCaller.supabase,
        input.makeMethodId as never
      )
    );
  }
});

/**
 * Get method tree
 *
 * @mcp read
 */
export const getMethodTreeTool = defineServiceFn({
  input: z.looseObject({ makeMethodId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMethodTree(ctx.asCaller.supabase, input.makeMethodId as never)
    );
  }
});

/**
 * Get bom item attributes
 *
 * @mcp read
 */
export const getBomItemAttributesTool = defineServiceFn({
  input: z.looseObject({ itemIds: z.array(z.string()) }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getBomItemAttributes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.itemIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get open job materials
 *
 * @mcp read
 */
export const getOpenJobMaterialsTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getOpenJobMaterials(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get open production orders
 *
 * @mcp read
 */
export const getOpenProductionOrdersTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getOpenProductionOrders(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get open purchase order lines
 *
 * @mcp read
 */
export const getOpenPurchaseOrderLinesTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getOpenPurchaseOrderLines(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get open sales order lines
 *
 * @mcp read
 */
export const getOpenSalesOrderLinesTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getOpenSalesOrderLines(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get part
 *
 * @mcp read
 */
export const getPartTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPart(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get parts
 *
 * @mcp read
 */
export const getPartsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getParts(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get item mpns list
 *
 * @mcp read
 */
export const getItemMpnsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return envelope(
      ctx,
      await getItemMpnsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get parts list
 *
 * @mcp read
 */
export const getPartsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return envelope(
      ctx,
      await getPartsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Where a part, tool or service is used
 *
 * @mcp read
 */
export const getPartUsedInTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getPartUsedIn(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get pick method
 *
 * @mcp read
 */
export const getPickMethodTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), locationId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPickMethod(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get pick methods
 *
 * @mcp read
 */
export const getPickMethodsTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPickMethods(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get services
 *
 * @mcp read
 */
export const getServicesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    group: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getServices(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get service
 *
 * @mcp read
 */
export const getServiceTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getService(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get services list
 *
 * @mcp read
 */
export const getServicesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return envelope(
      ctx,
      await getServicesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get supplier parts
 *
 * @mcp read
 */
export const getSupplierPartsTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierParts(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get supplier parts by supplier
 *
 * @mcp read
 */
export const getSupplierPartsBySupplierTool = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierPartsBySupplier(
        ctx.asCaller.supabase,
        input.supplierId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get tool
 *
 * @mcp read
 */
export const getToolTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getTool(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get tools
 *
 * @mcp read
 */
export const getToolsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getTools(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get unit of measure
 *
 * @mcp read
 */
export const getUnitOfMeasureTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getUnitOfMeasure(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Which tables still reference a unit of measure, and how many rows each; empty means safe to delete (or id not visible to the caller)
 *
 * @mcp read
 */
export const getUnitOfMeasureUsageTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getUnitOfMeasureUsage(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get unit of measures
 *
 * @mcp read
 */
export const getUnitOfMeasuresTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getUnitOfMeasures(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get unit of measures list
 *
 * @mcp read
 */
export const getUnitOfMeasuresListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return envelope(
      ctx,
      await getUnitOfMeasuresList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Update configuration parameter group order
 *
 * @mcp
 */
export const updateConfigurationParameterGroupOrderTool = defineServiceFn({
  input: z.looseObject({ id: z.string().min(1), sortOrder: z.number().min(0) }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateConfigurationParameterGroupOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Update default revision
 *
 * @mcp
 */
export const updateDefaultRevisionTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateDefaultRevision(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update configuration parameter order
 *
 * @mcp
 */
export const updateConfigurationParameterOrderTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().min(1),
    sortOrder: z.number().min(0),
    configurationParameterGroupId: z.string().nullable().optional()
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateConfigurationParameterOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update item cost
 *
 * @mcp
 */
export const updateItemCostTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    cost: z.looseObject({ unitCost: z.number() })
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateItemCost(
        ctx.asCaller.supabase,
        input.itemId as never,
        stamp(ctx, input.cost, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update material order
 *
 * @mcp
 */
export const updateMaterialOrderTool = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), order: z.number() }))
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelopes(
      ctx,
      await updateMaterialOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update operation order
 *
 * @mcp
 */
export const updateOperationOrderTool = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), order: z.number() }))
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelopes(
      ctx,
      await updateOperationOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update revision
 *
 * @mcp
 */
export const updateRevisionTool = defineServiceFn({
  input: z.looseObject({ id: z.string(), revision: z.string() }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateRevision(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Upsert configuration parameter
 *
 * @mcp
 */
export const upsertConfigurationParameterTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    itemId: z.string().min(1),
    key: z.string().optional(),
    label: z.string().min(1),
    dataType: z.enum([
      "text",
      "numeric",
      "boolean",
      "list",
      "material",
      "date"
    ]),
    listOptions: z.array(z.string().min(1)).optional(),
    configurationParameterGroupId: z.string().optional(),
    materialFormFilterId: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertConfigurationParameter(
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
 * Upsert configuration parameter group
 *
 * @mcp
 */
export const upsertConfigurationParameterGroupTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertConfigurationParameterGroup(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Upsert configuration rule
 *
 * @mcp
 */
export const upsertConfigurationRuleTool = defineServiceFn({
  input: z.looseObject({
    field: z.string().min(1),
    code: z.string().min(1),
    itemId: z.string()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertConfigurationRule(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Return the distinct processIds referenced by methodOperation rows on the item's active makeMethod
 *
 * @mcp read
 */
export const getRecipeProcessIdsForItemTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRecipeProcessIdsForItem(
        ctx.asCaller.supabase,
        input.itemId as never
      )
    );
  }
});

/**
 * Fetch the shelf-life policy for an item
 *
 * @mcp read
 */
export const getItemShelfLifeTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemShelfLife(ctx.asCaller.supabase, input.itemId as never)
    );
  }
});

/**
 * Returns true when the item's active make-method has at least one BOM input with a managed shelf-life policy
 *
 * @mcp read
 */
export const getBomHasShelfLifeManagedInputTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getBomHasShelfLifeManagedInput(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Atomic counterpart to {@link upsertPickMethod} + {@link upsertItemShelfLife}
 *
 * @mcp destructive
 */
export const upsertPickMethodWithShelfLifeTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    defaultStorageUnitId: z.string().nullable().optional(),
    sortMethod: z.enum(["Default", "FEFO", "FIFO", "LIFO"]).optional(),
    customFields: z.unknown().optional(),
    shelfLife: z.looseObject({
      mode: z
        .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
        .optional(),
      days: z.number().optional(),
      triggerProcessId: z.string().optional(),
      triggerTiming: z.enum(["Before", "After"]).optional(),
      calculateFromBom: z.boolean().optional()
    })
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await upsertPickMethodWithShelfLife(
        ctx.asSystem.pg,
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
 * Create a consumable
 *
 * @remarks
 * Creates a consumable (item row and consumable row) or updates one; on update `id` is the item id (uuid) or the consumable's readable id and the write is a full…
 *
 * @mcp
 */
export const upsertConsumableCreateTool = defineServiceFn({
  input: z.looseObject({
    id: z
      .string()
      .min(1)
      .max(255)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    readableId: z.string().optional(),
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    mpn: z.string().optional(),
    replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
    defaultMethodType: z.enum([
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ]),
    itemTrackingType: z.enum(["Inventory", "Non-Inventory", "Serial", "Batch"]),
    postingGroupId: z.string().optional(),
    unitOfMeasureCode: z.string().min(1),
    unitCost: z.number().min(0).optional(),
    defaultStorageUnitId: z.string().optional(),
    shelfLifeMode: z
      .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
      .optional(),
    shelfLifeDays: z.number().gt(0).optional(),
    shelfLifeTriggerProcessId: z.string().optional(),
    shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
    shelfLifeCalculateFromBom: z.boolean().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await upsertConsumable(
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
 * Update a consumable
 *
 * @remarks
 * Creates a consumable (item row and consumable row) or updates one; on update `id` is the item id (uuid) or the consumable's readable id and the write is a full…
 *
 * @mcp
 */
export const upsertConsumableUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      id: z
        .string()
        .min(1)
        .max(255)
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      readableId: z.string().optional(),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      mpn: z.string().optional(),
      replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
      defaultMethodType: z.enum([
        "Purchase to Order",
        "Pull from Inventory",
        "Make to Order"
      ]),
      itemTrackingType: z.enum([
        "Inventory",
        "Non-Inventory",
        "Serial",
        "Batch"
      ]),
      postingGroupId: z.string().optional(),
      unitOfMeasureCode: z.string().min(1),
      unitCost: z.number().min(0).optional(),
      defaultStorageUnitId: z.string().optional(),
      shelfLifeMode: z
        .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
        .optional(),
      shelfLifeDays: z.number().gt(0).optional(),
      shelfLifeTriggerProcessId: z.string().optional(),
      shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
      shelfLifeCalculateFromBom: z.boolean().optional(),
      customFields: z.unknown().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await upsertConsumable(
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
 * Resolve extracted document line text to an item id: first through the party's part mapping (customerPartToItem / supplierPart), then by exact readableId/name m…
 *
 * @mcp
 */
export const resolveItemIdFromExtractedTextTool = defineServiceFn({
  input: z.looseObject({
    party: z.union([
      z.looseObject({
        type: z.literal("customer"),
        id: z.string().nullable().optional()
      }),
      z.looseObject({
        type: z.literal("supplier"),
        id: z.string().nullable().optional()
      })
    ]),
    candidates: z.array(z.string().nullable())
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await resolveItemIdFromExtractedText(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.party, ["companyId"]) as never,
        stamp(ctx, input.candidates, ["companyId"]) as never
      )
    );
  }
});

/**
 * Update item
 *
 * @mcp
 */
export const updateItemTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().min(1).max(255),
    readableId: z.string().optional(),
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    mpn: z.string().optional(),
    replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
    defaultMethodType: z.enum([
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ]),
    itemTrackingType: z.enum(["Inventory", "Non-Inventory", "Serial", "Batch"]),
    postingGroupId: z.string().optional(),
    unitOfMeasureCode: z.string().min(1),
    unitCost: z.number().min(0).optional(),
    defaultStorageUnitId: z.string().optional(),
    shelfLifeMode: z
      .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
      .optional(),
    shelfLifeDays: z.number().gt(0).optional(),
    shelfLifeTriggerProcessId: z.string().optional(),
    shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
    shelfLifeCalculateFromBom: z.boolean().optional(),
    type: z.enum([
      "Part",
      "Material",
      "Tool",
      "Service",
      "Consumable",
      "Fixture"
    ])
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateItem(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Upsert item cost
 *
 * @mcp
 */
export const upsertItemCostTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string().min(1),
    itemPostingGroupId: z.string().optional(),
    costingMethod: z.enum(["Standard", "Average", "FIFO", "LIFO"]),
    unitCost: z.number().min(0),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertItemCost(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a pick method
 *
 * @remarks
 * Upsert pick method
 *
 * @mcp
 */
export const upsertPickMethodCreateTool = defineServiceFn({
  input: z.looseObject({
    itemId: z
      .string()
      .min(1)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    locationId: z
      .string()
      .min(1)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    defaultStorageUnitId: z.string().optional(),
    sortMethod: z.enum(["Default", "FEFO", "FIFO", "LIFO"]).optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPickMethod(
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
 * Update a pick method
 *
 * @remarks
 * Upsert pick method
 *
 * @mcp
 */
export const upsertPickMethodUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      itemId: z
        .string()
        .min(1)
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      locationId: z
        .string()
        .min(1)
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      defaultStorageUnitId: z.string().optional(),
      sortMethod: z.enum(["Default", "FEFO", "FIFO", "LIFO"]).optional(),
      customFields: z.unknown().optional()
    })
    .required({ itemId: true, locationId: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPickMethod(
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
 * Upsert item purchasing
 *
 * @mcp
 */
export const upsertItemPurchasingTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string().min(1),
    preferredSupplierId: z.string().optional(),
    conversionFactor: z.number().min(0),
    leadTime: z.number().min(0),
    purchasingUnitOfMeasureCode: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertItemPurchasing(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a item posting group
 *
 * @remarks
 * Upsert item posting group
 *
 * @mcp
 */
export const upsertItemPostingGroupCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertItemPostingGroup(
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
 * Update a item posting group
 *
 * @remarks
 * Upsert item posting group
 *
 * @mcp
 */
export const upsertItemPostingGroupUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertItemPostingGroup(
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
 * Upsert item customer part
 *
 * @mcp
 */
export const upsertItemCustomerPartTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string().min(1),
    customerId: z.string().min(1),
    customerPartId: z.string(),
    customerPartRevision: z.string().optional(),
    id: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertItemCustomerPart(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Upsert item unit sale price
 *
 * @mcp
 */
export const upsertItemUnitSalePriceTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string().min(1),
    unitSalePrice: z.number().min(0),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertItemUnitSalePrice(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a method material
 *
 * @remarks
 * Upsert method material
 *
 * @mcp
 */
export const upsertMethodMaterialCreateTool = defineServiceFn({
  input: z.looseObject({
    id: z
      .string()
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    makeMethodId: z.string().min(1),
    order: z.number().min(0),
    itemType: z.enum(["Part", "Material", "Consumable"]),
    kit: z.enum(["true", "false"]).optional(),
    methodType: z.enum([
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ]),
    sourcingType: z.enum(["Specified", "Drop Ship", "Ship from Inventory"]),
    itemId: z.string().optional(),
    methodOperationId: z.string().optional(),
    quantity: z.number().min(0),
    unitOfMeasureCode: z.string().min(1),
    storageUnitIds: z.record(z.string(), z.unknown()).nullable().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMethodMaterial(
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
 * Update a method material
 *
 * @remarks
 * Upsert method material
 *
 * @mcp
 */
export const upsertMethodMaterialUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      id: z
        .string()
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      makeMethodId: z.string().min(1),
      order: z.number().min(0),
      itemType: z.enum(["Part", "Material", "Consumable"]),
      kit: z.enum(["true", "false"]).optional(),
      methodType: z.enum([
        "Purchase to Order",
        "Pull from Inventory",
        "Make to Order"
      ]),
      sourcingType: z.enum(["Specified", "Drop Ship", "Ship from Inventory"]),
      itemId: z.string().optional(),
      methodOperationId: z.string().optional(),
      quantity: z.number().min(0),
      unitOfMeasureCode: z.string().min(1),
      storageUnitIds: z.record(z.string(), z.unknown()).nullable().optional(),
      customFields: z.unknown().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMethodMaterial(
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
 * Create a method operation
 *
 * @remarks
 * Upsert method operation
 *
 * @mcp
 */
export const upsertMethodOperationCreateTool = defineServiceFn({
  input: z.looseObject({
    makeMethodId: z.string().min(0),
    order: z.number().min(0),
    operationOrder: z.enum(["After Previous", "With Previous"]),
    operationType: z.enum([
      "Process",
      "Assembly",
      "Inspection",
      "Outside Processing"
    ]),
    processId: z.string().min(1),
    workCenterId: z.string().optional(),
    procedureId: z.string().optional(),
    assemblyInstructionId: z.string().optional(),
    inspectionDocumentId: z.string().optional(),
    description: z.string().min(0),
    setupUnit: z
      .enum([
        "Hours/Piece",
        "Hours/100 Pieces",
        "Hours/1000 Pieces",
        "Minutes/Piece",
        "Minutes/100 Pieces",
        "Minutes/1000 Pieces",
        "Pieces/Hour",
        "Pieces/Minute",
        "Seconds/Piece",
        "Total Hours",
        "Total Minutes"
      ])
      .optional(),
    setupTime: z.number().min(0).optional(),
    laborUnit: z
      .enum([
        "Hours/Piece",
        "Hours/100 Pieces",
        "Hours/1000 Pieces",
        "Minutes/Piece",
        "Minutes/100 Pieces",
        "Minutes/1000 Pieces",
        "Pieces/Hour",
        "Pieces/Minute",
        "Seconds/Piece",
        "Total Hours",
        "Total Minutes"
      ])
      .optional(),
    laborTime: z.number().min(0).optional(),
    machineUnit: z
      .enum([
        "Hours/Piece",
        "Hours/100 Pieces",
        "Hours/1000 Pieces",
        "Minutes/Piece",
        "Minutes/100 Pieces",
        "Minutes/1000 Pieces",
        "Pieces/Hour",
        "Pieces/Minute",
        "Seconds/Piece",
        "Total Hours",
        "Total Minutes"
      ])
      .optional(),
    machineTime: z.number().min(0).optional(),
    operationSupplierProcessId: z.string().optional(),
    operationMinimumCost: z.number().min(0).optional(),
    operationUnitCost: z.number().min(0).optional(),
    operationLeadTime: z.number().min(0).optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      )
      .optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMethodOperation(
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
 * Update a method operation
 *
 * @remarks
 * Upsert method operation
 *
 * @mcp
 */
export const upsertMethodOperationUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      makeMethodId: z.string().min(0),
      order: z.number().min(0),
      operationOrder: z.enum(["After Previous", "With Previous"]),
      operationType: z.enum([
        "Process",
        "Assembly",
        "Inspection",
        "Outside Processing"
      ]),
      processId: z.string().min(1),
      workCenterId: z.string().optional(),
      procedureId: z.string().optional(),
      assemblyInstructionId: z.string().optional(),
      inspectionDocumentId: z.string().optional(),
      description: z.string().min(0),
      setupUnit: z
        .enum([
          "Hours/Piece",
          "Hours/100 Pieces",
          "Hours/1000 Pieces",
          "Minutes/Piece",
          "Minutes/100 Pieces",
          "Minutes/1000 Pieces",
          "Pieces/Hour",
          "Pieces/Minute",
          "Seconds/Piece",
          "Total Hours",
          "Total Minutes"
        ])
        .optional(),
      setupTime: z.number().min(0).optional(),
      laborUnit: z
        .enum([
          "Hours/Piece",
          "Hours/100 Pieces",
          "Hours/1000 Pieces",
          "Minutes/Piece",
          "Minutes/100 Pieces",
          "Minutes/1000 Pieces",
          "Pieces/Hour",
          "Pieces/Minute",
          "Seconds/Piece",
          "Total Hours",
          "Total Minutes"
        ])
        .optional(),
      laborTime: z.number().min(0).optional(),
      machineUnit: z
        .enum([
          "Hours/Piece",
          "Hours/100 Pieces",
          "Hours/1000 Pieces",
          "Minutes/Piece",
          "Minutes/100 Pieces",
          "Minutes/1000 Pieces",
          "Pieces/Hour",
          "Pieces/Minute",
          "Seconds/Piece",
          "Total Hours",
          "Total Minutes"
        ])
        .optional(),
      machineTime: z.number().min(0).optional(),
      operationSupplierProcessId: z.string().optional(),
      operationMinimumCost: z.number().min(0).optional(),
      operationUnitCost: z.number().min(0).optional(),
      operationLeadTime: z.number().min(0).optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        )
        .optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMethodOperation(
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
 * Create a method operation step
 *
 * @remarks
 * Upsert method operation step
 *
 * @mcp
 */
export const upsertMethodOperationStepCreateTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    type: z.enum([
      "Task",
      "Value",
      "Measurement",
      "Checkbox",
      "Timestamp",
      "Person",
      "List",
      "File",
      "Inspection"
    ]),
    unitOfMeasureCode: z.string().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
    listValues: z.array(z.string()).optional(),
    sortOrder: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMethodOperationStep(
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
 * Update a method operation step
 *
 * @remarks
 * Upsert method operation step
 *
 * @mcp
 */
export const upsertMethodOperationStepUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      type: z.enum([
        "Task",
        "Value",
        "Measurement",
        "Checkbox",
        "Timestamp",
        "Person",
        "List",
        "File",
        "Inspection"
      ]),
      unitOfMeasureCode: z.string().optional(),
      minValue: z.number().nullable().optional(),
      maxValue: z.number().nullable().optional(),
      listValues: z.array(z.string()).optional(),
      sortOrder: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMethodOperationStep(
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
 * Duplicate method operation step
 *
 * @mcp
 */
export const duplicateMethodOperationStepTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await duplicateMethodOperationStep(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a method operation step slide
 *
 * @remarks
 * Upsert method operation step slide
 *
 * @mcp
 */
export const upsertMethodOperationStepSlideCreateTool = defineServiceFn({
  input: z.looseObject({
    stepId: z.string().min(1),
    imagePath: z.string().optional(),
    modelUploadId: z.string().optional(),
    caption: z.string().optional(),
    sortOrder: z.number().min(0).optional(),
    size: z.enum(["small", "medium", "large"]).optional(),
    annotations: z
      .array(
        z.looseObject({
          id: z.string(),
          x: z.number(),
          y: z.number(),
          label: z.string().nullable().optional(),
          color: z.string().nullable().optional(),
          toolId: z.string().nullable().optional()
        })
      )
      .nullable()
      .optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMethodOperationStepSlide(
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
 * Update a method operation step slide
 *
 * @remarks
 * Upsert method operation step slide
 *
 * @mcp
 */
export const upsertMethodOperationStepSlideUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      stepId: z.string().min(1),
      imagePath: z.string().optional(),
      modelUploadId: z.string().optional(),
      caption: z.string().optional(),
      sortOrder: z.number().min(0).optional(),
      size: z.enum(["small", "medium", "large"]).optional(),
      annotations: z
        .array(
          z.looseObject({
            id: z.string(),
            x: z.number(),
            y: z.number(),
            label: z.string().nullable().optional(),
            color: z.string().nullable().optional(),
            toolId: z.string().nullable().optional()
          })
        )
        .nullable()
        .optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMethodOperationStepSlide(
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
 * Create a method operation parameter
 *
 * @remarks
 * Upsert method operation parameter
 *
 * @mcp
 */
export const upsertMethodOperationParameterCreateTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    key: z.string().min(1),
    value: z.string().min(1),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMethodOperationParameter(
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
 * Update a method operation parameter
 *
 * @remarks
 * Upsert method operation parameter
 *
 * @mcp
 */
export const upsertMethodOperationParameterUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      key: z.string().min(1),
      value: z.string().min(1),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMethodOperationParameter(
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
 * Create a method operation tool
 *
 * @remarks
 * Upsert method operation tool
 *
 * @mcp
 */
export const upsertMethodOperationToolCreateTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    toolId: z.string().min(1),
    quantity: z.number().min(0.000001),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMethodOperationTool(
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
 * Update a method operation tool
 *
 * @remarks
 * Upsert method operation tool
 *
 * @mcp
 */
export const upsertMethodOperationToolUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      toolId: z.string().min(1),
      quantity: z.number().min(0.000001),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMethodOperationTool(
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
 * Set method material step link
 *
 * @mcp destructive
 */
export const setMethodMaterialStepLinkTool = defineServiceFn({
  input: z.looseObject({
    methodMaterialId: z.string(),
    methodOperationStepId: z.string(),
    linked: z.boolean(),
    quantity: z.number().nullable().optional()
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await setMethodMaterialStepLink(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Set method operation tool step link
 *
 * @mcp destructive
 */
export const setMethodOperationToolStepLinkTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string(),
    toolId: z.string(),
    methodOperationStepId: z.string(),
    linked: z.boolean()
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await setMethodOperationToolStepLink(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a material
 *
 * @remarks
 * Creates a material or updates one by item id or readable id; an update keeps any optional field it leaves out, and `sizes` adds a revision per new size
 *
 * @mcp
 */
export const upsertMaterialCreateTool = defineServiceFn({
  input: z.looseObject({
    id: z
      .string()
      .min(1)
      .max(255)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    readableId: z.string().optional(),
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    mpn: z.string().optional(),
    replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
    defaultMethodType: z.enum([
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ]),
    itemTrackingType: z.enum(["Inventory", "Non-Inventory", "Serial", "Batch"]),
    postingGroupId: z.string().optional(),
    unitOfMeasureCode: z.string().min(1),
    unitCost: z.number().min(0).optional(),
    defaultStorageUnitId: z.string().optional(),
    shelfLifeMode: z
      .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
      .optional(),
    shelfLifeDays: z.number().gt(0).optional(),
    shelfLifeTriggerProcessId: z.string().optional(),
    shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
    shelfLifeCalculateFromBom: z.boolean().optional(),
    materialSubstanceId: z.string().optional(),
    materialFormId: z.string().optional(),
    materialTypeId: z.string().optional(),
    finishId: z.string().optional(),
    gradeId: z.string().optional(),
    dimensionId: z.string().optional(),
    sizes: z.array(z.string()).optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await upsertMaterial(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
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
 * Update a material
 *
 * @remarks
 * Creates a material or updates one by item id or readable id; an update keeps any optional field it leaves out, and `sizes` adds a revision per new size
 *
 * @mcp
 */
export const upsertMaterialUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      id: z
        .string()
        .min(1)
        .max(255)
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        ),
      readableId: z.string().optional(),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      mpn: z.string().optional(),
      replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
      defaultMethodType: z.enum([
        "Purchase to Order",
        "Pull from Inventory",
        "Make to Order"
      ]),
      itemTrackingType: z.enum([
        "Inventory",
        "Non-Inventory",
        "Serial",
        "Batch"
      ]),
      postingGroupId: z.string().optional(),
      unitOfMeasureCode: z.string().min(1),
      unitCost: z.number().min(0).optional(),
      defaultStorageUnitId: z.string().optional(),
      shelfLifeMode: z
        .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
        .optional(),
      shelfLifeDays: z.number().gt(0).optional(),
      shelfLifeTriggerProcessId: z.string().optional(),
      shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
      shelfLifeCalculateFromBom: z.boolean().optional(),
      materialSubstanceId: z.string().optional(),
      materialFormId: z.string().optional(),
      materialTypeId: z.string().optional(),
      finishId: z.string().optional(),
      gradeId: z.string().optional(),
      dimensionId: z.string().optional(),
      sizes: z.array(z.string()).optional(),
      customFields: z.unknown().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await upsertMaterial(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
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
 * Creates a dimension (a named size) for a material shape, or updates the one whose `id` is sent; a new dimension's id is generated
 *
 * @mcp
 */
export const upsertMaterialDimensionTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1).max(255),
    materialFormId: z.string().min(1),
    isMetric: z.boolean().optional(),
    id: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaterialDimension(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Creates a finish for a material substance, or updates the one whose `id` is sent; a new finish's id is generated
 *
 * @mcp
 */
export const upsertMaterialFinishTool = defineServiceFn({
  input: z.looseObject({
    materialSubstanceId: z.string().min(1),
    name: z.string().min(1).max(255),
    id: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaterialFinish(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Create a material form
 *
 * @remarks
 * Upsert material form
 *
 * @mcp
 */
export const upsertMaterialFormCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1).max(255),
    code: z.string().min(1).max(10),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaterialForm(
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
 * Update a material form
 *
 * @remarks
 * Upsert material form
 *
 * @mcp
 */
export const upsertMaterialFormUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1).max(255),
      code: z.string().min(1).max(10),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaterialForm(
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
 * Creates a grade for a material substance, or updates the one whose `id` is sent; a new grade's id is generated
 *
 * @mcp
 */
export const upsertMaterialGradeTool = defineServiceFn({
  input: z.looseObject({
    materialSubstanceId: z.string().min(1),
    name: z.string().min(1).max(255),
    id: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaterialGrade(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Delete material type
 *
 * @mcp destructive
 */
export const deleteMaterialTypeTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteMaterialType(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get material types
 *
 * @mcp read
 */
export const getMaterialTypesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getMaterialTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get material type
 *
 * @mcp read
 */
export const getMaterialTypeTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaterialType(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get material type list
 *
 * @mcp read
 */
export const getMaterialTypeListTool = defineServiceFn({
  input: z.looseObject({
    materialSubstanceId: z.string(),
    materialFormId: z.string()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMaterialTypeList(
        ctx.asCaller.supabase,
        input.materialSubstanceId as never,
        input.materialFormId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Creates a material type for a substance and shape pair, or updates the one whose `id` is sent; a new type's id is generated
 *
 * @mcp
 */
export const upsertMaterialTypeTool = defineServiceFn({
  input: z.looseObject({
    materialSubstanceId: z.string().min(1),
    materialFormId: z.string().min(1),
    name: z.string().min(1).max(255),
    code: z.string().min(1).max(10),
    id: z.string().optional()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaterialType(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Create a material substance
 *
 * @remarks
 * Upsert material substance
 *
 * @mcp
 */
export const upsertMaterialSubstanceCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1).max(255),
    code: z.string().min(1).max(10),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaterialSubstance(
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
 * Update a material substance
 *
 * @remarks
 * Upsert material substance
 *
 * @mcp
 */
export const upsertMaterialSubstanceUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1).max(255),
      code: z.string().min(1).max(10),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMaterialSubstance(
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
 * Create a service
 *
 * @remarks
 * Creates a service (item row and service row) or updates one
 *
 * @mcp
 */
export const upsertServiceCreateTool = defineServiceFn({
  input: z.looseObject({
    id: z
      .string()
      .max(255)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      )
      .optional(),
    readableId: z.string().optional(),
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    mpn: z.string().optional(),
    replenishmentSystem: z.enum(["Buy", "Make"]),
    defaultMethodType: z.enum([
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ]),
    itemTrackingType: z.literal("Non-Inventory"),
    postingGroupId: z.string().optional(),
    unitOfMeasureCode: z.string().optional(),
    unitCost: z.number().min(0).optional(),
    defaultStorageUnitId: z.string().optional(),
    shelfLifeMode: z
      .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
      .optional(),
    shelfLifeDays: z.number().gt(0).optional(),
    shelfLifeTriggerProcessId: z.string().optional(),
    shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
    shelfLifeCalculateFromBom: z.boolean().optional(),
    revision: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertService(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
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
 * Update a service
 *
 * @remarks
 * Creates a service (item row and service row) or updates one
 *
 * @mcp
 */
export const upsertServiceUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      id: z
        .string()
        .max(255)
        .describe(
          "Updates the existing record with this key; creates one when there is none."
        )
        .optional(),
      readableId: z.string().optional(),
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      mpn: z.string().optional(),
      replenishmentSystem: z.enum(["Buy", "Make"]),
      defaultMethodType: z.enum([
        "Purchase to Order",
        "Pull from Inventory",
        "Make to Order"
      ]),
      itemTrackingType: z.literal("Non-Inventory"),
      postingGroupId: z.string().optional(),
      unitOfMeasureCode: z.string().optional(),
      unitCost: z.number().min(0).optional(),
      defaultStorageUnitId: z.string().optional(),
      shelfLifeMode: z
        .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
        .optional(),
      shelfLifeDays: z.number().gt(0).optional(),
      shelfLifeTriggerProcessId: z.string().optional(),
      shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
      shelfLifeCalculateFromBom: z.boolean().optional(),
      revision: z.string().optional(),
      customFields: z.unknown().optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertService(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
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
 * Create a unit of measure
 *
 * @remarks
 * Upsert unit of measure
 *
 * @mcp
 */
export const upsertUnitOfMeasureCreateTool = defineServiceFn({
  input: z.looseObject({
    code: z.string().min(1).max(10),
    name: z.string().min(1).max(50),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertUnitOfMeasure(
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
 * Update a unit of measure
 *
 * @remarks
 * Upsert unit of measure
 *
 * @mcp
 */
export const upsertUnitOfMeasureUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      code: z.string().min(1).max(10),
      name: z.string().min(1).max(50),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertUnitOfMeasure(
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
 * Create a tool
 *
 * @remarks
 * Creates a tool (item row and tool row) or updates one; on update `id` is the item id (uuid) or the tool's readable id and the write is a full replace, so omitt…
 *
 * @mcp
 */
export const upsertToolCreateTool = defineServiceFn({
  input: z.looseObject({
    id: z
      .string()
      .min(1)
      .max(255)
      .describe(
        "Updates the existing record with this key; creates one when there is none."
      ),
    readableId: z.string().optional(),
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    mpn: z.string().optional(),
    replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
    defaultMethodType: z.enum([
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ]),
    itemTrackingType: z.enum(["Inventory", "Non-Inventory", "Serial", "Batch"]),
    postingGroupId: z.string().optional(),
    unitOfMeasureCode: z.string().min(1),
    unitCost: z.number().min(0).optional(),
    defaultStorageUnitId: z.string().optional(),
    shelfLifeMode: z
      .enum(["NotManaged", "Fixed Duration", "Calculated", "Set on Receipt"])
      .optional(),
    shelfLifeDays: z.number().gt(0).optional(),
    shelfLifeTriggerProcessId: z.string().optional(),
    shelfLifeTriggerTiming: z.enum(["Before", "After"]).optional(),
    shelfLifeCalculateFromBom: z.boolean().optional(),
    revision: z.string().min(1),
    modelUploadId: z.string().optional(),
    lotSize: z.number().min(0).optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await upsertTool(
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
 * Batch pre-fetch supplier pricing for multiple items, for costing
 *
 * @mcp read
 */
export const getSupplierPriceBreaksForItemsTool = defineServiceFn({
  input: z.looseObject({ itemIds: z.array(z.string()) }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getSupplierPriceBreaksForItems(
        ctx.asCaller.supabase,
        stamp(ctx, input.itemIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get change notice
 *
 * @mcp read
 */
export const getChangeNoticeTool = defineServiceFn({
  input: z.looseObject({ changeNoticeId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getChangeNotice(
        ctx.asCaller.supabase,
        input.changeNoticeId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get change notices
 *
 * @mcp read
 */
export const getChangeNoticesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getChangeNotices(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Update change notice
 *
 * @mcp
 */
export const updateChangeNoticeTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    changeOrderId: z.string().optional(),
    name: z.string().optional(),
    type: z.enum(["Engineering", "Manufacturing", "Documentation"]).optional(),
    priority: z.string().nullable().optional(),
    changeOrderTypeId: z.string().nullable().optional(),
    nonConformanceId: z.string().nullable().optional(),
    openDate: z.string().optional(),
    reasonForChange: z.unknown().optional(),
    description: z.unknown().optional(),
    dueDate: z.string().nullable().optional(),
    assignee: z.string().nullable().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateChangeNotice(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Delete change notice
 *
 * @mcp destructive
 */
export const deleteChangeNoticeTool = defineServiceFn({
  input: z.looseObject({ changeNoticeId: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteChangeNotice(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.changeNoticeId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get change notice types
 *
 * @mcp read
 */
export const getChangeNoticeTypesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getChangeNoticeTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get change notice types list
 *
 * @mcp read
 */
export const getChangeNoticeTypesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return envelope(
      ctx,
      await getChangeNoticeTypesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get change notice type
 *
 * @mcp read
 */
export const getChangeNoticeTypeTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getChangeNoticeType(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Create a change notice type
 *
 * @remarks
 * Upsert change notice type
 *
 * @mcp
 */
export const upsertChangeNoticeTypeCreateTool = defineServiceFn({
  input: z.looseObject({
    changeNoticeType: z.looseObject({
      name: z.string(),
      customFields: z.unknown().optional()
    })
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertChangeNoticeType(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input.changeNoticeType,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a change notice type
 *
 * @remarks
 * Upsert change notice type
 *
 * @mcp
 */
export const upsertChangeNoticeTypeUpdateTool = defineServiceFn({
  input: z.looseObject({
    changeNoticeType: z.looseObject({
      id: z.string(),
      name: z.string(),
      customFields: z.unknown().optional()
    })
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertChangeNoticeType(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input.changeNoticeType,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Delete change notice type
 *
 * @mcp destructive
 */
export const deleteChangeNoticeTypeTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteChangeNoticeType(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Add change notice affected item
 *
 * @mcp destructive
 */
export const addChangeNoticeAffectedItemTool = defineServiceFn({
  input: z.looseObject({
    changeNoticeId: z.string(),
    itemId: z.string().optional(),
    changeType: z.enum(["Version", "Revision", "Replacement Part", "New Part"]),
    revision: z.string().optional(),
    newPart: z
      .looseObject({
        readableId: z.string(),
        name: z.string(),
        itemType: z.enum(["Part", "Tool"]),
        replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]),
        itemTrackingType: z
          .enum(["Inventory", "Non-Inventory", "Serial", "Batch"])
          .optional()
      })
      .optional()
  }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await addChangeNoticeAffectedItem(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
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
 * Update change notice affected item change type
 *
 * @mcp
 */
export const updateChangeNoticeAffectedItemChangeTypeTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    changeType: z.enum(["Version", "Revision", "Replacement Part", "New Part"])
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateChangeNoticeAffectedItemChangeType(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Update change notice affected item cutover
 *
 * @mcp
 */
export const updateChangeNoticeAffectedItemCutoverTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    supersessionMode: z.enum([
      "Consume First",
      "Prefer New",
      "Stock Only",
      "No Stock"
    ]),
    discontinuationDate: z.string().optional(),
    successorEffectivityDate: z.string().optional()
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateChangeNoticeAffectedItemCutover(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Get change notice affected items
 *
 * @mcp read
 */
export const getChangeNoticeAffectedItemsTool = defineServiceFn({
  input: z.looseObject({ changeNoticeId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getChangeNoticeAffectedItems(
        ctx.asCaller.supabase,
        input.changeNoticeId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Remove change notice affected item
 *
 * @mcp destructive
 */
export const removeChangeNoticeAffectedItemTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await removeChangeNoticeAffectedItem(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get change notices for non conformance
 *
 * @mcp read
 */
export const getChangeNoticesForNonConformanceTool = defineServiceFn({
  input: z.looseObject({ nonConformanceId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getChangeNoticesForNonConformance(
        ctx.asCaller.supabase,
        input.nonConformanceId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get change notice actions
 *
 * @mcp read
 */
export const getChangeNoticeActionsTool = defineServiceFn({
  input: z.looseObject({ changeNoticeId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getChangeNoticeActions(
        ctx.asCaller.supabase,
        input.changeNoticeId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Update change notice action status
 *
 * @mcp
 */
export const updateChangeNoticeActionStatusTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    status: z.enum(["Pending", "In Progress", "Completed", "Skipped"])
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateChangeNoticeActionStatus(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Delete change notice action
 *
 * @mcp destructive
 */
export const deleteChangeNoticeActionTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteChangeNoticeAction(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Update change notice action order
 *
 * @mcp
 */
export const updateChangeNoticeActionOrderTool = defineServiceFn({
  input: z.looseObject({
    changeNoticeId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updateChangeNoticeActionOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        input.changeNoticeId as never,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Get change notice required actions
 *
 * @mcp read
 */
export const getChangeNoticeRequiredActionsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getChangeNoticeRequiredActions(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get change notice required actions list
 *
 * @mcp read
 */
export const getChangeNoticeRequiredActionsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "parts" },
  async run(ctx) {
    return envelope(
      ctx,
      await getChangeNoticeRequiredActionsList(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get change notice required action
 *
 * @mcp read
 */
export const getChangeNoticeRequiredActionTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getChangeNoticeRequiredAction(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Upsert change notice required action
 *
 * @mcp
 */
export const upsertChangeNoticeRequiredActionTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    name: z.string(),
    active: z.boolean()
  }),
  permission: { create: "parts", update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertChangeNoticeRequiredAction(
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
 * Delete change notice required action
 *
 * @mcp destructive
 */
export const deleteChangeNoticeRequiredActionTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteChangeNoticeRequiredAction(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Set change notice action tasks
 *
 * @mcp destructive
 */
export const setChangeNoticeActionTasksTool = defineServiceFn({
  input: z.looseObject({
    changeNoticeId: z.string(),
    requiredActionIds: z.array(z.string())
  }),
  permission: { update: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await setChangeNoticeActionTasks(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Get change notice diff
 *
 * @mcp read
 */
export const getChangeNoticeDiffTool = defineServiceFn({
  input: z.looseObject({ changeNoticeId: z.string() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getChangeNoticeDiff(
        ctx.asCaller.supabase,
        input.changeNoticeId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Create a presigned upload URL for an item (part/material/tool/consumable/service) document
 *
 * @mcp
 */
export const createItemDocumentUploadUrlTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), name: z.string() }),
  permission: { create: "parts" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createItemDocumentUploadUrl(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});
