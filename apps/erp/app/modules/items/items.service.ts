import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable, getCompanyTimeZone } from "@carbon/database";
import type {
  ExpressionBuilder,
  Kysely,
  KyselyDatabase,
  KyselyTx
} from "@carbon/database/client";
import { storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { datetime, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import type { z } from "zod";
import { createDocumentUploadUrl } from "~/modules/documents/documents.service";
import type { GenericQueryFilters } from "~/utils/query";
import {
  LIST_COUNT,
  setGenericQueryFilters,
  setSearchFilter
} from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type { nonConformancePriority } from "../quality/quality.models";
import type {
  operationParameterValidator,
  operationStepSlideValidator,
  operationStepValidator,
  operationToolValidator
} from "../shared";
import {
  lookupBuyPriceFromMap,
  type MethodType,
  normalizeOperationSourceIds,
  type PriceBreak,
  type SourcingType,
  type SupplierPriceMap
} from "../shared";
import {
  ACTIVE_JOB_MATERIAL,
  ACTIVE_PRODUCING_JOB,
  CHANGE_NOTICE_IMPACT_BULK_PREVIEW_STALE_MESSAGE,
  type ChangeNoticeChangeType,
  type ChangeNoticeError,
  type ChangeNoticeImpactCandidate,
  type ChangeNoticeImpactCandidateOptions,
  type ChangeNoticeImpactCandidateReadModel,
  type ChangeNoticeImpactCandidateReadResult,
  type ChangeNoticeImpactCoverage,
  type ChangeNoticeImpactDecisionBulkMutationInput,
  type ChangeNoticeImpactDecisionBulkWriteResult,
  type ChangeNoticeImpactDecisionMutationInput,
  type ChangeNoticeImpactDecisionOperation,
  type ChangeNoticeImpactDecisionProjection,
  type ChangeNoticeImpactDecisionStatus,
  type ChangeNoticeImpactDecisionWriteData,
  type ChangeNoticeImpactDecisionWriteResult,
  type ChangeNoticeImpactDomainCursor,
  type ChangeNoticeImpactExposureClassification,
  type ChangeNoticeImpactHistoryEntry,
  type ChangeNoticeImpactHistoryProvenance,
  type ChangeNoticeImpactHistoryReadResult,
  type ChangeNoticeImpactHistorySnapshotStatus,
  type ChangeNoticeImpactItemContext,
  type ChangeNoticeImpactJobMaterialSnapshotInput,
  type ChangeNoticeImpactJobSnapshotInput,
  type ChangeNoticeImpactNoActionReasonCode,
  type ChangeNoticeImpactParentContext,
  type ChangeNoticeImpactProvenance,
  type ChangeNoticeImpactProvenanceReconciliationInput,
  type ChangeNoticeImpactProvenanceReconciliationResult,
  type ChangeNoticeImpactPurchaseOrderLineSnapshotInput,
  type ChangeNoticeImpactSnapshot,
  type ChangeNoticeImpactSnapshotNormalization,
  type ChangeNoticeImpactSourceAccess,
  type ChangeNoticeImpactSourceAccessResult,
  type ChangeNoticeImpactTargetType,
  type ChangeNoticeImpactTaskCoverage,
  type ChangeNoticeImpactTaskCreateMutationInput,
  type ChangeNoticeImpactTaskCreateResult,
  type ChangeNoticeImpactTaskDesignationResult,
  type ChangeNoticeImpactTaskLink,
  type ChangeNoticeImpactTaskRelationshipMutationInput,
  type ChangeNoticeImpactTaskRelationshipResult,
  type ChangeNoticeImpactWorkspaceCandidate,
  type ChangeNoticeImpactWorkspaceDecisionProjection,
  type ChangeNoticeImpactWorkspaceReadModel,
  type ChangeNoticeImpactWorkspaceReadResult,
  type ChangeNoticeImpactWorkspaceSnapshot,
  type ChangeNoticeItemDiff,
  canEditChangeNoticeEngineering,
  changeNoticeActionTaskOrigins,
  changeNoticeImpactDecisionStatuses,
  changeNoticeImpactNoActionReasonCodes,
  changeNoticeImpactTargetTypes,
  changeNoticeLockedMessage,
  changeNoticeOpenStatuses,
  changeNoticeStageFlow,
  type changeNoticeStatus,
  changeNoticeTaskStatus,
  type changeNoticeType,
  type configurationParameterGroupOrderValidator,
  type configurationParameterGroupValidator,
  type configurationParameterOrderValidator,
  type configurationParameterValidator,
  type configurationRuleValidator,
  type consumableValidator,
  type customerPartValidator,
  deriveChangeNoticeImpactDecisionOperation,
  type getMethodValidator,
  ItemTrackingType,
  isAllowedChangeNoticeTransition,
  type itemCostValidator,
  type itemManufacturingValidator,
  type itemPlanningValidator,
  type itemPostingGroupValidator,
  type itemPurchasingValidator,
  type itemSupersessionValidator,
  type itemTrackingTypes,
  type itemUnitSalePriceValidator,
  type itemValidator,
  JOB_MATERIAL_SNAPSHOT_V1,
  JOB_SNAPSHOT_V1,
  type JobImpactSnapshot,
  type JobMaterialImpactSnapshot,
  jobImpactActiveStatuses,
  jobImpactHistoricalStatuses,
  type MethodDiffEntry,
  type MethodDiffStatus,
  type makeMethodVersionValidator,
  type materialDimensionValidator,
  type materialFinishValidator,
  type materialFormValidator,
  type materialGradeValidator,
  type materialSubstanceValidator,
  type materialTypeValidator,
  type materialValidator,
  type methodMaterialValidator,
  type methodOperationValidator,
  OPEN_PURCHASING_COMMITMENT,
  type OperationChildrenDiff,
  type OperationDiffEntry,
  PO_LINE_SNAPSHOT_V1,
  type PurchaseOrderLineImpactSnapshot,
  type partValidator,
  type pickMethodSortMethods,
  type pickMethodValidator,
  purchaseOrderLineImpactCurrentStatuses,
  purchaseOrderLineImpactHistoricalStatuses,
  purchaseOrderLineImpactNonAssessmentTypes,
  type serviceValidator,
  type shelfLifeModes,
  type shelfLifeTriggerTimings,
  type supplierPartValidator,
  type toolValidator,
  type unitOfMeasureValidator,
  validateChangeNoticeImpactFirstAssessment
} from "./items.models";
import type { InventoryItemType } from "./types";

const PARTS_LIST_COLUMNS =
  "active,defaultMethodType,description,itemTrackingType,name,replenishmentSystem,unitOfMeasureCode,revision,readableId,readableIdWithRevision,id,companyId,thumbnailPath,supplierIds,revisions,customFields,tags,itemPostingGroupId,createdBy,createdAt,updatedBy,updatedAt,supersessionMode,mpn,suppliers" as const;

const MATERIALS_LIST_COLUMNS =
  "active,defaultMethodType,description,itemTrackingType,name,unitOfMeasureCode,revision,readableId,readableIdWithRevision,id,companyId,thumbnailPath,supplierIds,unitOfMeasure,revisions,materialForm,materialSubstance,dimensions,finish,grade,materialType,materialSubstanceId,materialFormId,customFields,tags,itemPostingGroupId,createdBy,createdAt,updatedBy,updatedAt,supersessionMode,mpn,suppliers" as const;

const TOOLS_LIST_COLUMNS =
  "active,assignee,defaultMethodType,description,itemTrackingType,name,replenishmentSystem,revision,readableIdWithRevision,id,companyId,thumbnailPath,supplierIds,revisions,customFields,tags,itemPostingGroupId,createdBy,createdAt,updatedBy,updatedAt,supersessionMode,mpn,suppliers" as const;

const CONSUMABLES_LIST_COLUMNS =
  "active,assignee,defaultMethodType,description,itemTrackingType,name,replenishmentSystem,readableIdWithRevision,id,companyId,thumbnailPath,supplierIds,customFields,tags,itemPostingGroupId,createdBy,createdAt,updatedBy,updatedAt,supersessionMode,mpn,suppliers" as const;

const SERVICES_LIST_COLUMNS =
  "active,defaultMethodType,description,name,replenishmentSystem,revision,readableIdWithRevision,id,companyId,thumbnailPath,supplierIds,revisions,customFields,tags,itemPostingGroupId,createdBy,createdAt,updatedBy,updatedAt,suppliers" as const;

const logger = getLogger("erp", "items");

class ImpactMutationRejected extends Error {}

export async function activateMethodVersion(
  client: SupabaseClient<Database>,
  payload: {
    id: string;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke<{ convertedId: string }>("convert", {
    body: {
      type: "methodVersionToActive",
      ...payload
    }
  });
}

export async function copyItem(
  client: SupabaseClient<Database>,
  args: z.infer<typeof getMethodValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("get-method", {
    body: {
      type: "itemToItem",
      sourceId: args.sourceId,
      targetId: args.targetId,
      companyId: args.companyId,
      userId: args.userId,
      parts: {
        billOfMaterial: args.billOfMaterial,
        billOfProcess: args.billOfProcess,
        parameters: args.parameters,
        tools: args.tools,
        steps: args.steps,
        workInstructions: args.workInstructions
      }
    }
  });
}

export async function copyMakeMethod(
  client: SupabaseClient<Database>,
  args: z.infer<typeof getMethodValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("get-method", {
    body: {
      type: "makeMethodToMakeMethod",
      sourceId: args.sourceId,
      targetId: args.targetId,
      companyId: args.companyId,
      userId: args.userId,
      parts: {
        billOfMaterial: args.billOfMaterial,
        billOfProcess: args.billOfProcess,
        parameters: args.parameters,
        tools: args.tools,
        steps: args.steps,
        workInstructions: args.workInstructions
      }
    }
  });
}

// Copy a source item's item group (itemPostingGroupId, stored on itemCost) onto a
// freshly-created target item whose itemCost row was just auto-created with
// defaults by the item-insert trigger. No-op when the source has no group set.
export async function copyItemPostingGroup(
  client: SupabaseClient<Database>,
  args: { sourceItemId: string; targetItemId: string; companyId: string | null }
) {
  if (!args.companyId) return;
  const source = await client
    .from("itemCost")
    .select("itemPostingGroupId")
    .eq("itemId", args.sourceItemId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  const groupId = source.data?.itemPostingGroupId ?? null;
  if (!groupId) return;
  await client
    .from("itemCost")
    .update({ itemPostingGroupId: groupId })
    .eq("itemId", args.targetItemId)
    .eq("companyId", args.companyId);
}

export async function createRevision(
  client: SupabaseClient<Database>,
  args: {
    item: NonNullable<Awaited<ReturnType<typeof getItem>>["data"]>;
    revision: string;
    createdBy: string;
    // Change-order draft revisions are created inactive so they don't surface
    // in item pickers/production until the change notice is released. Manual
    // "New Revision" keeps the default (active).
    active?: boolean;
  }
) {
  const { item, revision, createdBy, active = true } = args;
  const itemInsert = await client
    .from("item")
    .insert({
      readableId: item.readableId,
      revision: revision,
      name: item.name,
      type: item.type,
      replenishmentSystem: item.replenishmentSystem,
      defaultMethodType: item.defaultMethodType,
      itemTrackingType: item.itemTrackingType,
      unitOfMeasureCode: item.unitOfMeasureCode,
      // A revision starts as a faithful copy of the source's attributes so the
      // only differences the user (and the CO diff) sees are ones they made.
      description: item.description,
      sourcingType: item.sourcingType,
      thumbnailPath: item.thumbnailPath,
      mpn: item.mpn,
      active,
      modelUploadId: item.modelUploadId,
      companyId: item.companyId,
      createdBy: createdBy
    })
    .select("id")
    .single();

  if (itemInsert.error) {
    return itemInsert;
  }

  // Carry the source's item group (itemPostingGroupId lives on itemCost, which
  // the item-insert trigger auto-creates with defaults) onto the new revision.
  await copyItemPostingGroup(client, {
    sourceItemId: item.id,
    targetItemId: itemInsert.data.id,
    companyId: item.companyId
  });

  if (item.replenishmentSystem !== "Buy") {
    await client.functions.invoke("get-method", {
      body: {
        type: "itemToItem",
        sourceId: item.id,
        targetId: itemInsert.data.id,
        companyId: item.companyId,
        userId: createdBy
      }
    });
  }

  return itemInsert;
}

// getNextRevision — numeric → +1, A → …→ Z → AA, AA → AB, etc.
export function getNextRevision(maxRevision: string): string {
  if (/^\d+$/.test(maxRevision)) {
    return (parseInt(maxRevision) + 1).toString();
  } else if (/^[A-Z]{1,2}$/.test(maxRevision)) {
    if (maxRevision.length === 1) {
      return maxRevision === "Z"
        ? "AA"
        : String.fromCharCode(maxRevision.charCodeAt(0) + 1);
    }
    const firstChar = maxRevision[0];
    const secondChar = maxRevision[1];
    if (secondChar === "Z") {
      return String.fromCharCode(firstChar.charCodeAt(0) + 1) + "A";
    }
    return firstChar + String.fromCharCode(secondChar.charCodeAt(0) + 1);
  }
  return maxRevision;
}

export async function deleteConfigurationParameter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("configurationParameter").delete().eq("id", id);
}

export async function deleteConfigurationRule(
  client: SupabaseClient<Database>,
  field: string,
  itemId: string
) {
  return client
    .from("configurationRule")
    .delete()
    .eq("field", field)
    .eq("itemId", itemId);
}

export async function deleteItemCustomerPart(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("customerPartToItem")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function deleteSupplierPart(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("supplierPart")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function deleteConfigurationParameterGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  // Get any parameters that belong to this group
  const { data: parameters } = await client
    .from("configurationParameter")
    .select("id")
    .eq("configurationParameterGroupId", id);

  if (parameters && parameters.length > 0) {
    // Get the ungrouped group
    const { data: ungrouped } = await client
      .from("configurationParameterGroup")
      .select("id")
      .eq("isUngrouped", true)
      .single();

    if (ungrouped) {
      // Update all parameters to use the ungrouped group
      await client
        .from("configurationParameter")
        .update({ configurationParameterGroupId: ungrouped.id })
        .eq("configurationParameterGroupId", id);
    }
  }
  return client.from("configurationParameterGroup").delete().eq("id", id);
}

export async function deleteItem(client: SupabaseClient<Database>, id: string) {
  return client.from("item").delete().eq("id", id);
}

export async function deleteItemPostingGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("itemPostingGroup").delete().eq("id", id);
}

export async function deleteMaterialDimension(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialDimension").delete().eq("id", id);
}

export async function deleteMaterialFinish(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialFinish").delete().eq("id", id);
}

export async function deleteMaterialForm(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialForm").delete().eq("id", id);
}

export async function deleteMaterialGrade(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialGrade").delete().eq("id", id);
}

export async function deleteMaterialSubstance(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialSubstance").delete().eq("id", id);
}

export async function deleteMethodMaterial(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodMaterial").delete().eq("id", id);
}

export async function assertMethodOperationIsDraft(
  client: SupabaseClient<Database>,
  operationId: string
) {
  const result = await client
    .from("methodOperation")
    .select("makeMethodId, makeMethod!inner(status)")
    .eq("id", operationId)
    .single();

  if (result.error || !result.data) {
    throw new Error("Failed to find method operation");
  }

  const status = (result.data.makeMethod as { status: string }).status;
  if (status !== "Draft") {
    throw new Error(
      `Cannot modify steps on a method version with status "${status}". Only Draft versions can be modified.`
    );
  }
}

export async function deleteMethodOperation(
  client: SupabaseClient<Database>,
  methodOperationId: string
) {
  return client.from("methodOperation").delete().eq("id", methodOperationId);
}

export async function deleteMethodOperationStep(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodOperationStep").delete().eq("id", id);
}

export async function deleteMethodOperationStepSlide(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodOperationStepSlide").delete().eq("id", id);
}

export async function deleteMethodOperationParameter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodOperationParameter").delete().eq("id", id);
}

export async function deleteMethodOperationTool(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodOperationTool").delete().eq("id", id);
}

export async function deleteUnitOfMeasure(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("unitOfMeasure").delete().eq("id", id);
}

export async function getConfigurationParameters(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [parameters, groups] = await Promise.all([
    client
      .from("configurationParameter")
      .select("*")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("configurationParameterGroup")
      .select("*")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
  ]);

  if (parameters.error) {
    logger.error("Failed to get configuration parameters", {
      error: parameters.error
    });
    return { groups: [], parameters: [] };
  }

  if (groups.error) {
    logger.error("Failed to get configuration parameter groups", {
      error: groups.error
    });
    return { groups: [], parameters: [] };
  }

  return { groups: groups.data ?? [], parameters: parameters.data ?? [] };
}

export async function getConfigurationRules(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const result = await client
    .from("configurationRule")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
  if (result.error) {
    logger.error("Failed to get configuration rules", { error: result.error });
    return [];
  }
  return result.data ?? [];
}

export async function getConsumable(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .rpc("get_consumable_details", {
      item_id: itemId
    })
    .single();
}

export async function getConsumables(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("consumables")
    .select(CONSUMABLES_LIST_COLUMNS, {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  query = setSearchFilter(query, args.search, [
    "readableIdWithRevision",
    "name",
    "description",
    "supplierIds",
    "mpn"
  ]);

  if (args.supplierId) {
    query = query.contains("suppliers", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getConsumablesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    readableIdWithRevision: string;
  }>(client, "item", "id, name, readableIdWithRevision", (query) =>
    query
      .eq("type", "Consumable")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name")
  );
}

export async function getItem(client: SupabaseClient<Database>, id: string) {
  return client.from("item").select("*").eq("id", id).single();
}

export async function getItemCost(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemCost")
    .select("*, ...item(readableIdWithRevision)")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .single();
}

export async function getItemCostHistory(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const dateOneYearAgo = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .subtract({ years: 1 })
    .toString();

  return client
    .from("costLedger")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .gte("postingDate", dateOneYearAgo)
    .order("postingDate", { ascending: false })
    .limit(500);
}

export async function getItemCustomerPart(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("customerPartToItem")
    .select("*, customer(id, name)")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getItemCustomerParts(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("customerPartToItem")
    .select("*, customer(id, name)")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
}

export async function getItemDemand(
  client: SupabaseClient<Database>,
  {
    itemId,
    locationId,
    periods,
    companyId
  }: {
    itemId: string;
    locationId: string;
    periods: string[];
    companyId: string;
  }
) {
  const [actuals, forecasts] = await Promise.all([
    client
      .from("demandActual")
      .select("*")
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId)
      .in("periodId", periods),
    client
      .from("demandForecast")
      .select("*")
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId)
      .in("periodId", periods)
      .order("periodId")
  ]);

  return {
    actuals: actuals.data ?? [],
    forecasts: forecasts.data ?? []
  };
}

export type DemandForecastSourceRow = {
  itemId: string;
  locationId: string | null;
  periodId: string;
  sourceType: "Job Material" | "Sales Order" | "Demand Projection";
  quantity: number;
  jobId: string | null;
  salesOrderLineId: string | null;
  demandProjectionId: string | null;
  parentItemId: string;
  parentItem: { id: string; readableId: string; name: string } | null;
  redirectedFromItemId: string | null;
  redirectedFromItem: {
    id: string;
    readableIdWithRevision: string;
  } | null;
  job: {
    id: string;
    jobId: string;
    dueDate: string | null;
    status: string | null;
  } | null;
  salesOrderLine: {
    id: string;
    salesOrderId: string;
    promisedDate: string | null;
    salesOrder: { id: string; salesOrderId: string } | null;
  } | null;
  demandProjection: {
    id: string;
    forecastQuantity: number;
    forecastMethod: string | null;
    confidence: number | null;
    notes: string | null;
    createdBy: string;
    createdAt: string;
    period: { startDate: string } | null;
  } | null;
};

export async function getDemandForecastSources(
  client: SupabaseClient<Database>,
  {
    itemId,
    locationId,
    periods,
    companyId
  }: {
    itemId: string;
    locationId: string;
    periods: string[];
    companyId: string;
  }
) {
  const result = await client
    .from("demandForecastSource")
    .select(
      `
        itemId,
        locationId,
        periodId,
        sourceType,
        quantity,
        jobId,
        salesOrderLineId,
        demandProjectionId,
        parentItemId,
        parentItem:item!demandForecastSource_parentItemId_fkey(id, readableId, name),
        redirectedFromItemId,
        redirectedFromItem:item!demandForecastSource_redirectedFromItemId_fkey(id, readableIdWithRevision),
        job:job!demandForecastSource_jobId_fkey(id, jobId, dueDate, status),
        salesOrderLine:salesOrderLine!demandForecastSource_salesOrderLineId_fkey(
          id,
          salesOrderId,
          promisedDate,
          salesOrder:salesOrder(id, salesOrderId)
        ),
        demandProjection:demandProjection!demandForecastSource_demandProjectionId_fkey(
          id,
          forecastQuantity,
          forecastMethod,
          confidence,
          notes,
          period(startDate),
          createdBy,
          createdAt
        )
      `
    )
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId)
    .in("periodId", periods);

  return {
    data: result.data ?? [],
    error: result.error
  };
}

export async function getItemFiles(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const result = await storage(client)
    .company(companyId)
    .list(`${companyId}/parts/${itemId}`);
  return result.data ?? [];
}

export async function getItemPostingGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("itemPostingGroup").select("*").eq("id", id).single();
}

export async function getItemPostingGroups(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("itemPostingGroup")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getItemPostingGroupsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("itemPostingGroup")
    .select("id, name", { count: "exact" })
    .eq("companyId", companyId)
    .order("name");
}

export async function getItemManufacturing(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("itemReplenishment")
    .select("*")
    .eq("itemId", id)
    .eq("companyId", companyId)
    .single();
}

export async function getItemPlanning(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client
    .from("itemPlanning")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .maybeSingle();
}

export async function getItemQuantities(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  // item_id restricts the RPC to one item so it doesn't aggregate the whole
  // location's ledger/PO/SO/job history for a single detail page (added in
  // migration 20260713231142; the committed DB types regenerate from the
  // cloud DB after deploy, hence the cast).
  return client
    .rpc("get_inventory_quantities", {
      location_id: locationId,
      company_id: companyId,
      item_id: itemId
    } as { location_id: string; company_id: string })
    .eq("id", itemId)
    .maybeSingle();
}

/**
 * On-hand quantity per item for the Item picker's badge, as a plain map.
 *
 * `locationId` of "all" totals every location (including the '' bucket for
 * ledger rows with no location), matching what the picker shows when no
 * location is in play. Zero rows are dropped — the picker renders no badge for
 * an item it has no row for, so they carry no information and are the bulk of
 * the table on a tenant with history.
 */
export async function getItemStockQuantitiesByLocation(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  const { data, error } = await fetchAllFromTable<{
    itemId: string;
    quantityOnHand: number;
  }>(client, "itemStockQuantities", "itemId, quantityOnHand", (query) => {
    const scoped = query
      .eq("companyId", companyId)
      .neq("quantityOnHand", 0)
      // Total order across the whole key: fetchAllFromTable pages, and without
      // one a concurrent write can shift a row across a page boundary.
      .order("itemId")
      .order("locationId");

    return locationId === "all" ? scoped : scoped.eq("locationId", locationId);
  });

  if (error) return { data: null, error };

  const quantities: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!row.itemId) continue;
    quantities[row.itemId] =
      (quantities[row.itemId] ?? 0) + (Number(row.quantityOnHand) || 0);
  }

  return { data: quantities, error: null };
}

export async function getItemReplenishment(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemReplenishment")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .single();
}

export async function getItemSupersession(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  // itemSupersession has two FKs to item, so embeds must hint the FK.
  return client
    .from("itemSupersession")
    .select(
      "*, successor:item!itemSupersession_successorItemId_fkey(id, readableIdWithRevision, name)"
    )
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .maybeSingle();
}

export async function getItemSupersessionsForItems(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
) {
  if (itemIds.length === 0) return { data: [], error: null };
  return client
    .from("itemSupersession")
    .select(
      "itemId, supersessionMode, successorItemId, successorEffectivityDate, conversionFactor, successor:item!itemSupersession_successorItemId_fkey(readableIdWithRevision)"
    )
    .in("itemId", itemIds)
    .eq("companyId", companyId);
}

// Parts that point to this item as their successor (the "Supersedes" back-ref).
export async function getItemSupersededBy(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemSupersession")
    .select(
      "itemId, supersessionMode, successorEffectivityDate, predecessor:item!itemSupersession_itemId_fkey(id, readableIdWithRevision, name)"
    )
    .eq("successorItemId", itemId)
    .eq("companyId", companyId);
}

export async function getSupersessionChain(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  // Forward chain (this item -> successor -> ...), cycle-safe, capped depth.
  type ChainLink = {
    itemId: string;
    supersessionMode: Database["public"]["Enums"]["supersessionMode"];
    successorItemId: string | null;
    successorEffectivityDate: string | null;
    successor: {
      id: string;
      readableIdWithRevision: string | null;
      name: string;
    } | null;
  };
  const chain: ChainLink[] = [];
  const visited = new Set<string>();
  let currentId: string | null = itemId;
  while (currentId && !visited.has(currentId) && chain.length < 5) {
    visited.add(currentId);
    const link = await client
      .from("itemSupersession")
      .select(
        "itemId, supersessionMode, successorItemId, successorEffectivityDate, successor:item!itemSupersession_successorItemId_fkey(id, readableIdWithRevision, name)"
      )
      .eq("itemId", currentId)
      .eq("companyId", companyId)
      .maybeSingle();
    const data = link.data as ChainLink | null;
    if (!data) break;
    chain.push(data);
    currentId = data.successorItemId;
  }

  const supersededBy = await getItemSupersededBy(client, itemId, companyId);

  return { chain, supersededBy: supersededBy.data ?? [] };
}

export async function getItemStorageUnitQuantities(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client.rpc("get_item_quantities_by_tracking_id", {
    item_id: itemId,
    company_id: companyId,
    location_id: locationId
  });
}

export async function getItemSupply(
  client: SupabaseClient<Database>,
  {
    itemId,
    locationId,
    periods,
    companyId
  }: {
    itemId: string;
    locationId: string;
    periods: string[];
    companyId: string;
  }
) {
  const [actuals, forecasts] = await Promise.all([
    client
      .from("supplyActual")
      .select("*")
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId)
      .in("periodId", periods)
      .order("periodId"),
    client
      .from("supplyForecast")
      .select("*")
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId)
      .in("periodId", periods)
      .order("periodId")
  ]);

  return {
    actuals: actuals.data ?? [],
    forecasts: forecasts.data ?? []
  };
}

export async function getItemUnitSalePrice(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("itemUnitSalePrice")
    .select("*")
    .eq("itemId", id)
    .eq("companyId", companyId)
    .single();
}

export async function getJobMaterialUsageForItem(
  client: SupabaseClient<Database>,
  { itemId, companyId }: { itemId: string; companyId: string }
): Promise<{
  byMaterialId: Record<string, number>;
  byJobId: Record<string, number>;
}> {
  const [materials, jobs] = await Promise.all([
    client
      .from("jobMaterial")
      .select("id, estimatedQuantity")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("job")
      .select("id, quantity")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
  ]);

  const byMaterialId: Record<string, number> = {};
  for (const row of materials.data ?? []) {
    if (row.id) byMaterialId[row.id] = row.estimatedQuantity ?? 0;
  }

  const byJobId: Record<string, number> = {};
  for (const row of jobs.data ?? []) {
    if (row.id) byJobId[row.id] = row.quantity ?? 0;
  }

  return { byMaterialId, byJobId };
}

export async function getMaterialUsedIn(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [
    issues,
    jobMaterials,
    maintenanceDispatchItems,
    methodMaterials,
    purchaseOrderLines,
    receiptLines,
    quoteMaterials,
    salesOrderLines,
    shipmentLines,
    supplierQuotes,
    inspections,
    jobMaterialUsage
  ] = await Promise.all([
    client
      .from("nonConformanceItem")
      .select(
        "id, ...nonConformance(documentReadableId:nonConformanceId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("jobMaterial")
      .select("id, methodType, ...job(documentReadableId:jobId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("maintenanceDispatchItem")
      .select(
        "id, ...maintenanceDispatch!maintenanceDispatchId(documentReadableId:maintenanceDispatchId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("methodMaterial")
      .select(
        "id, methodType, ...makeMethod!makeMethodId(documentId:id, version, ...item(documentReadableId:readableIdWithRevision, documentParentId:id, itemType:type))"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("purchaseOrderLine")
      .select(
        "id, ...purchaseOrder(documentReadableId:purchaseOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("receiptLine")
      .select("id, ...receipt(documentReadableId:receiptId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("quoteMaterial")
      .select(
        "id, methodType, documentParentId:quoteId, documentId:quoteLineId, ...quoteLine(...item(documentReadableId:readableIdWithRevision))"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("salesOrderLine")
      .select(
        "id, methodType, ...salesOrder(documentReadableId:salesOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("shipmentLine")
      .select("id, ...shipment(documentReadableId:shipmentId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("supplierQuoteLine")
      .select(
        "id, ...supplierQuote(documentReadableId:supplierQuoteId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100),
    client
      .from("inspection")
      .select("id, documentReadableId:inspectionId")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    getJobMaterialUsageForItem(client, { itemId, companyId })
  ]);

  return {
    issues: issues.data ?? [],
    jobMaterials: jobMaterials.data ?? [],
    maintenanceDispatchItems: maintenanceDispatchItems.data ?? [],
    methodMaterials: methodMaterials.data ?? [],
    purchaseOrderLines: purchaseOrderLines.data ?? [],
    receiptLines: receiptLines.data ?? [],
    quoteMaterials: quoteMaterials.data ?? [],
    salesOrderLines: salesOrderLines.data ?? [],
    shipmentLines: shipmentLines.data ?? [],
    supplierQuotes: supplierQuotes.data ?? [],
    inspections: inspections.data ?? [],
    jobMaterialUsage
  };
}

export async function getMakeMethods(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("makeMethod")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
}

export async function getMakeMethodById(
  client: SupabaseClient<Database>,
  makeMethodId: string,
  companyId: string
) {
  return client
    .from("makeMethod")
    .select("*")
    .eq("id", makeMethodId)
    .eq("companyId", companyId)
    .single();
}

export async function getMaterial(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .rpc("get_material_details", {
      item_id: itemId
    })
    .single();
}

export async function getMaterials(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("materials")
    .select(MATERIALS_LIST_COLUMNS, {
      count: LIST_COUNT
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  query = setSearchFilter(query, args.search, [
    "readableIdWithRevision",
    "name",
    "description",
    "supplierIds",
    "mpn"
  ]);

  if (args.supplierId) {
    query = query.contains("suppliers", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getMaterialsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    readableIdWithRevision: string;
  }>(client, "item", "id, name, readableIdWithRevision", (query) =>
    query
      .eq("type", "Material")
      .or(`companyId.eq.${companyId},companyId.is.null`)
      .eq("active", true)
      .order("name")
  );
}

function buildSearchFilter(search: string, columns: string[]) {
  const value = `"%${search.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}%"`;
  return columns.map((column) => `${column}.ilike.${value}`).join(",");
}

export async function getMaterialDimension(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialDimension").select("*").eq("id", id).single();
}

export async function getMaterialDimensions(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null; isMetric: boolean }
) {
  let query = client
    .from("materialDimensions")
    .select("*", {
      count: "exact"
    })
    .eq("isMetric", args?.isMetric ?? false)
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.or(
      buildSearchFilter(args.search, ["name", "formName", "id"])
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "formName", ascending: true },
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialDimensionList(
  client: SupabaseClient<Database>,
  materialFormId: string,
  isMetric: boolean,
  companyId: string
) {
  return client
    .from("materialDimension")
    .select("*")
    .eq("materialFormId", materialFormId)
    .eq("isMetric", isMetric)
    .or(`companyId.eq.${companyId},companyId.is.null`);
}

export async function getMaterialFinish(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialFinish").select("*").eq("id", id).single();
}

export async function getMaterialFinishes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialFinishes")
    .select("*", {
      count: "exact"
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.or(
      buildSearchFilter(args.search, ["name", "substanceName", "id"])
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "substanceName", ascending: true },
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialFinishList(
  client: SupabaseClient<Database>,
  materialSubstanceId: string,
  companyId: string
) {
  return client
    .from("materialFinish")
    .select("*")
    .eq("materialSubstanceId", materialSubstanceId)
    .or(`companyId.eq.${companyId},companyId.is.null`);
}

export async function getMaterialForm(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialForm").select("*").eq("id", id).single();
}

export async function getMaterialForms(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialForm")
    .select("*", {
      count: "exact"
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialFormsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("materialForm")
    .select("id, name, code, companyId")
    .or(`companyId.eq.${companyId},companyId.is.null`)
    .order("name");
}

export async function getMaterialGrades(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialGrades")
    .select("*", {
      count: "exact"
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.or(
      buildSearchFilter(args.search, ["name", "substanceName", "id"])
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "substanceName", ascending: true },
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialGrade(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialGrade").select("*").eq("id", id).single();
}

export async function getMaterialGradeList(
  client: SupabaseClient<Database>,
  materialSubstanceId: string,
  companyId: string
) {
  return client
    .from("materialGrade")
    .select("*")
    .eq("materialSubstanceId", materialSubstanceId)
    .or(`companyId.eq.${companyId},companyId.is.null`);
}

export async function getMaterialSubstance(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialSubstance").select("*").eq("id", id).single();
}

export async function getMaterialSubstances(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialSubstance")
    .select("*", {
      count: "exact"
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialSubstancesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("materialSubstance")
    .select("id, name, code, companyId")
    .or(`companyId.eq.${companyId},companyId.is.null`)
    .order("name");
}

export async function getMethodMaterial(
  client: SupabaseClient<Database>,
  materialId: string
) {
  return client
    .from("methodMaterial")
    .select("*, item(name)")
    .eq("id", materialId)
    .single();
}

export async function getMethodMaterials(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("methodMaterial")
    .select(
      "*, item(name, readableIdWithRevision), makeMethod!makeMethodId(item(id, type, name, readableIdWithRevision))",
      {
        count: "exact"
      }
    )
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("item.readableIdWithRevision", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, []);
  }

  return query;
}

// The step-link `quantity` column ships with this branch's migration, which only
// runs on main — previews (and the prod window between app deploy and migration)
// run this code against the pre-migration schema. PostgREST fails the WHOLE
// select on an unknown embedded column, so fall back to the quantity-less query
// instead of rendering an empty BOM. 42703 = Postgres undefined_column; PGRST204
// = PostgREST's schema-cache miss for a written column.
function isMissingQuantityColumn(
  error: { code?: string; message?: string } | null
) {
  return error?.code === "42703" || error?.code === "PGRST204";
}

export async function getMethodMaterialsByMakeMethod(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  const result = await client
    .from("methodMaterial")
    .select(
      "*, item(name, itemTrackingType, replenishmentSystem, defaultMethodType, sourcingType), methodMaterialStep(methodOperationStepId, quantity)"
    )
    .eq("makeMethodId", makeMethodId)
    .order("order", { ascending: true });
  if (isMissingQuantityColumn(result.error)) {
    return (await client
      .from("methodMaterial")
      .select(
        "*, item(name, itemTrackingType, replenishmentSystem, defaultMethodType, sourcingType), methodMaterialStep(methodOperationStepId)"
      )
      .eq("makeMethodId", makeMethodId)
      .order("order", { ascending: true })) as unknown as typeof result;
  }
  return result;
}

export async function getMethodOperations(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("methodOperation")
    .select(
      "*, makeMethod!makeMethodId(item(id, type, name, readableIdWithRevision))",
      {
        count: "exact"
      }
    )
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("description", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "order", ascending: true }
    ]);
  }

  return query;
}

export async function getMethodOperationsByMakeMethodId(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  return client
    .from("methodOperation")
    .select(
      "*, methodOperationTool(*, methodOperationToolStep(methodOperationStepId)), methodOperationParameter(*), methodOperationStep(*, methodOperationStepSlide(*))"
    )
    .eq("makeMethodId", makeMethodId)
    .order("order", { ascending: true });
}

type Method = NonNullable<
  Awaited<ReturnType<typeof getMethodTreeArray>>["data"]
>[number];
type MethodTreeItem = {
  id: string;
  data: Method;
  children: MethodTreeItem[];
};

export async function getMethodTree(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  const items = await getMethodTreeArray(client, makeMethodId);
  if (items.error) return items;

  const tree = getMethodTreeArrayToTree(items.data);

  return {
    data: tree,
    error: null
  };
}

export async function getMethodTreeArray(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  return client.rpc("get_method_tree", {
    uid: makeMethodId
  });
}

function getMethodTreeArrayToTree(items: Method[]): MethodTreeItem[] {
  function traverseAndRenameIds(node: MethodTreeItem) {
    const clone = structuredClone(node);
    clone.id = nanoid();
    clone.children = clone.children.map((n) => traverseAndRenameIds(n));
    return clone;
  }

  const rootItems: MethodTreeItem[] = [];
  const lookup: { [id: string]: MethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-ignore
      lookup[itemId] = { id: itemId, children: [] };
    }

    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-ignore
        lookup[parentId] = { id: parentId, children: [] };
      }

      // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
      lookup[parentId]["children"].push(treeItem);
    }
  }

  return rootItems.map((item) => traverseAndRenameIds(item));
}

export type BomItemAttributes = {
  readableId: string;
  revision: string;
  itemTrackingType: Database["public"]["Enums"]["itemTrackingType"];
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
  itemPostingGroup: string | null;
  lotSize: number | null;
  leadTime: number | null;
};

export async function getBomItemAttributes(
  client: SupabaseClient<Database>,
  companyId: string,
  itemIds: string[]
) {
  const [items, costs, replenishments] = await Promise.all([
    client
      .from("item")
      .select("id, readableId, revision, itemTrackingType, replenishmentSystem")
      .in("id", itemIds)
      .eq("companyId", companyId),
    client
      .from("itemCost")
      .select("itemId, ...itemPostingGroup(itemPostingGroup:name)")
      .in("itemId", itemIds)
      .eq("companyId", companyId),
    client
      .from("itemReplenishment")
      .select("itemId, lotSize, leadTime")
      .in("itemId", itemIds)
      .eq("companyId", companyId)
  ]);

  const error = items.error ?? costs.error ?? replenishments.error;
  if (error) return { data: null, error };

  const postingGroupByItemId = new Map(
    (costs.data ?? []).map((c) => [c.itemId, c.itemPostingGroup])
  );
  const replenishmentByItemId = new Map(
    (replenishments.data ?? []).map((r) => [r.itemId, r])
  );

  const data = new Map<string, BomItemAttributes>(
    (items.data ?? []).map((item) => [
      item.id,
      {
        readableId: item.readableId,
        revision: item.revision ?? "",
        itemTrackingType: item.itemTrackingType,
        replenishmentSystem: item.replenishmentSystem,
        itemPostingGroup: postingGroupByItemId.get(item.id) ?? null,
        lotSize: replenishmentByItemId.get(item.id)?.lotSize ?? null,
        leadTime: replenishmentByItemId.get(item.id)?.leadTime ?? null
      }
    ])
  );

  return { data, error: null };
}

export async function getOpenJobMaterials(
  client: SupabaseClient<Database>,
  {
    itemId,
    companyId,
    locationId
  }: { itemId: string; companyId: string; locationId: string }
) {
  return client
    .from("openJobMaterialLines")
    .select(
      "id, parentMaterialId, jobMakeMethodId, jobId, quantity:quantityToIssue, quantityPerParent, documentReadableId:jobReadableId, documentId:jobId, dueDate"
    )
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId);
}

export async function getOpenProductionOrders(
  client: SupabaseClient<Database>,
  {
    itemId,
    companyId,
    locationId
  }: { itemId: string; companyId: string; locationId: string }
) {
  return client
    .from("openProductionOrders")
    .select(
      "id, quantity:quantityToReceive, documentReadableId:jobId, documentId:id, dueDate"
    )
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId);
}

export async function getOpenPurchaseOrderLines(
  client: SupabaseClient<Database>,
  {
    itemId,
    companyId,
    locationId
  }: { itemId: string; companyId: string; locationId: string }
) {
  return client
    .from("openPurchaseOrderLines")
    .select(
      "id, quantity:quantityToReceive, dueDate:promisedDate, ...purchaseOrder(documentReadableId:purchaseOrderId, documentId:id)"
    )
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId);
}

export async function getOpenSalesOrderLines(
  client: SupabaseClient<Database>,
  {
    itemId,
    companyId,
    locationId
  }: { itemId: string; companyId: string; locationId: string }
) {
  return client
    .from("openSalesOrderLines")
    .select(
      "id, quantity:quantityToSend, dueDate:promisedDate, ...salesOrder(documentReadableId:salesOrderId, documentId:id)"
    )
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId);
}

export async function getPart(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .rpc("get_part_details", {
      item_id: itemId
    })
    .single();
}

export async function getParts(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("parts")
    .select(PARTS_LIST_COLUMNS, {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  query = setSearchFilter(query, args.search, [
    "readableIdWithRevision",
    "name",
    "description",
    "supplierIds",
    "mpn"
  ]);

  if (args.supplierId) {
    query = query.contains("suppliers", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

// Distinct manufacturer part numbers for the company, used to populate the MPN
// column filter in the item list tables. Deduping happens in the route loader.
export async function getItemMpnsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{ mpn: string }>(client, "item", "mpn", (query) =>
    query
      .eq("companyId", companyId)
      .not("mpn", "is", null)
      .neq("mpn", "")
      .order("mpn")
  );
}

export async function getPartsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    readableIdWithRevision: string;
  }>(client, "item", "id, name, readableIdWithRevision", (query) =>
    query
      .eq("type", "Part")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name")
  );
}

export async function getPartUsedIn(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [
    issues,
    jobMaterials,
    jobs,
    maintenanceDispatchItems,
    methodMaterials,
    purchaseOrderLines,
    receiptLines,
    quoteLines,
    quoteMaterials,
    salesOrderLines,
    shipmentLines,
    supplierQuotes,
    assemblyInstructions,
    inspections,
    jobMaterialUsage
  ] = await Promise.all([
    client
      .from("nonConformanceItem")
      .select(
        "id, ...nonConformance(documentReadableId:nonConformanceId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("jobMaterial")
      .select("id, methodType, ...job(documentReadableId:jobId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("job")
      .select("id, documentReadableId:jobId")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("maintenanceDispatchItem")
      .select(
        "id, ...maintenanceDispatch!maintenanceDispatchId(documentReadableId:maintenanceDispatchId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("methodMaterial")
      .select(
        "id, methodType, ...makeMethod!makeMethodId(documentId:id, version, ...item(documentReadableId:readableIdWithRevision, documentParentId:id, itemType:type))"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("purchaseOrderLine")
      .select(
        "id, ...purchaseOrder(documentReadableId:purchaseOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("receiptLine")
      .select("id, ...receipt(documentReadableId:receiptId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("quoteLine")
      .select(
        "id, methodType, ...quote(documentReadableId:quoteId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100),

    client
      .from("quoteMaterial")
      .select(
        "id, methodType, documentParentId:quoteId, documentId:quoteLineId, ...quoteLine(...item(documentReadableId:readableIdWithRevision))"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("salesOrderLine")
      .select(
        "id, methodType, ...salesOrder(documentReadableId:salesOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("shipmentLine")
      .select("id, ...shipment(documentReadableId:shipmentId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("supplierQuoteLine")
      .select(
        "id, ...supplierQuote(documentReadableId:supplierQuoteId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100),
    client
      .from("assemblyInstruction")
      .select("id, documentReadableId:name, version")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    client
      .from("inspection")
      .select("id, documentReadableId:inspectionId")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .limit(100)
      .order("createdAt", { ascending: false }),
    getJobMaterialUsageForItem(client, { itemId, companyId })
  ]);

  return {
    issues: issues.data ?? [],
    jobMaterials: jobMaterials.data ?? [],
    jobs: jobs.data ?? [],
    maintenanceDispatchItems: maintenanceDispatchItems.data ?? [],
    methodMaterials: methodMaterials.data ?? [],
    purchaseOrderLines: purchaseOrderLines.data ?? [],
    receiptLines: receiptLines.data ?? [],
    quoteLines: quoteLines.data ?? [],
    quoteMaterials: quoteMaterials.data ?? [],
    salesOrderLines: salesOrderLines.data ?? [],
    shipmentLines: shipmentLines.data ?? [],
    supplierQuotes: supplierQuotes.data ?? [],
    assemblyInstructions: assemblyInstructions.data ?? [],
    inspections: inspections.data ?? [],
    jobMaterialUsage
  };
}

export async function getPickMethod(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client
    .from("pickMethod")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .maybeSingle();
}

export async function getPickMethods(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("pickMethod")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
}

export async function getServices(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    group: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("services")
    .select(SERVICES_LIST_COLUMNS, {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  query = setSearchFilter(query, args.search, [
    "readableIdWithRevision",
    "name",
    "description",
    "supplierIds"
  ]);

  if (args.group) {
    query = query.eq("itemPostingGroupId", args.group);
  }

  if (args.supplierId) {
    query = query.contains("suppliers", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getService(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  // get_service_details returns the same shape as get_tool_details. The RPC only
  // enters the committed (cloud-sourced) types once the migration is applied to
  // the cloud DB, so until then we borrow the tool-details typing while calling
  // the real RPC. Drop the cast after the next cloud type regeneration.
  return client
    .rpc("get_service_details" as unknown as "get_tool_details", {
      item_id: itemId
    })
    .single();
}

export async function getServicesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    readableIdWithRevision: string;
  }>(client, "item", "id, name, readableIdWithRevision", (query) =>
    query
      .eq("type", "Service")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name")
  );
}

export async function getSupplierParts(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("supplierPart")
    .select("*")
    .eq("active", true)
    .eq("itemId", id)
    .eq("companyId", companyId);
}

export async function getTool(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .rpc("get_tool_details", {
      item_id: itemId
    })
    .single();
}

export async function getTools(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("tools")
    .select(TOOLS_LIST_COLUMNS, {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  query = setSearchFilter(query, args.search, [
    "readableIdWithRevision",
    "name",
    "description",
    "supplierIds",
    "mpn"
  ]);

  if (args.supplierId) {
    query = query.contains("suppliers", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getToolsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    readableIdWithRevision: string;
  }>(client, "item", "id, name, readableIdWithRevision", (query) =>
    query
      .eq("type", "Tool")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name")
  );
}

export async function getUnitOfMeasure(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("unitOfMeasure")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

/**
 * Which tables still reference a unit of measure, and how many rows each;
 * empty means safe to delete (or id not visible to the caller). RPC-backed so
 * the answer doesn't depend on the caller's module permissions.
 */
export async function getUnitOfMeasureUsage(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.rpc("get_unit_of_measure_usage", { p_id: id });
}

export async function getUnitOfMeasures(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("unitOfMeasure")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(`name.ilike.%${args.search}%,code.ilike.%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getUnitOfMeasuresList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("unitOfMeasure")
    .select("name, code")
    .eq("companyId", companyId)
    .order("name");
}

export async function updateConfigurationParameterGroupOrder(
  client: SupabaseClient<Database>,
  data: z.infer<typeof configurationParameterGroupOrderValidator>
) {
  return client
    .from("configurationParameterGroup")
    .update(sanitize(data))
    .eq("id", data.id);
}

export async function updateDefaultRevision(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    updatedBy: string;
  }
) {
  const [item, makeMethod] = await Promise.all([
    client
      .from("item")
      .select("id,readableId, readableIdWithRevision, type, companyId")
      .eq("id", data.id)
      .single(),
    client
      .from("activeMakeMethods")
      .select("id, version")
      .eq("itemId", data.id)
      .maybeSingle()
  ]);
  if (item.error) return item;
  const { readableId, type, companyId } = item.data;
  if (!companyId) return item;
  const relatedItems = await client
    .from("item")
    .select("id")
    .eq("readableId", readableId)
    .eq("type", type)
    .eq("companyId", companyId);

  const itemIds = relatedItems.data?.map((item) => item.id) ?? [];

  return client
    .from("methodMaterial")
    .update({
      itemId: item.data.id,
      materialMakeMethodId: makeMethod.data?.id
    })
    .in("itemId", itemIds);
}

export async function updateConfigurationParameterOrder(
  client: SupabaseClient<Database>,
  data: Omit<
    z.infer<typeof configurationParameterOrderValidator>,
    "configurationParameterGroupId"
  > & {
    configurationParameterGroupId?: string | null;
    updatedBy: string;
  }
) {
  return client
    .from("configurationParameter")
    .update(sanitize(data))
    .eq("id", data.id);
}

export async function updateItemCost(
  client: SupabaseClient<Database>,
  itemId: string,
  cost: {
    unitCost: number;
    updatedBy: string;
  }
) {
  return client
    .from("itemCost")
    .update({
      ...cost,
      costIsAdjusted: true,
      updatedAt: datetime.timestamp()
    })
    .eq("itemId", itemId)
    .single();
}

export async function updateMaterialOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    order: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, order, updatedBy }) =>
    client.from("methodMaterial").update({ order, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function updateOperationOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    order: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, order, updatedBy }) =>
    client.from("methodOperation").update({ order, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function updateRevision(
  client: SupabaseClient<Database>,
  revision: {
    id: string;
    revision: string;
    updatedBy: string;
  }
) {
  return client
    .from("item")
    .update({
      ...revision,
      updatedAt: datetime.timestamp()
    })
    .eq("id", revision.id);
}

export async function upsertConfigurationParameter(
  client: SupabaseClient<Database>,
  configurationParameter: z.infer<typeof configurationParameterValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const { userId, ...data } = configurationParameter;
  if (configurationParameter.id) {
    return client
      .from("configurationParameter")
      .update(
        sanitize({
          ...data,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
      )
      .eq("id", configurationParameter.id);
  }

  let ungroupedGroupId: string | null = null;
  const existingGroups = await client
    .from("configurationParameterGroup")
    .select("id, isUngrouped, sortOrder")
    .eq("itemId", data.itemId);

  const ungroupedGroup = existingGroups.data?.find(
    (group) => group.isUngrouped
  );

  if (ungroupedGroup) {
    ungroupedGroupId = ungroupedGroup.id;
  } else {
    const maxSortOrder =
      existingGroups.data?.reduce(
        (max, group) => Math.max(max, group.sortOrder ?? 1),
        1
      ) ?? 0;
    const ungroupedGroupInsert = await client
      .from("configurationParameterGroup")
      .insert({
        itemId: data.itemId,
        name: "Ungrouped",
        isUngrouped: true,
        sortOrder: maxSortOrder + 1,
        companyId: data.companyId
      })
      .select("id")
      .single();
    if (ungroupedGroupInsert.error) return ungroupedGroupInsert;
    ungroupedGroupId = ungroupedGroupInsert.data.id;
  }

  return client.from("configurationParameter").insert({
    ...data,
    key: data.key ?? "",
    createdBy: userId,
    configurationParameterGroupId: ungroupedGroupId
  });
}

export async function upsertConfigurationParameterGroup(
  client: SupabaseClient<Database>,
  configurationParameterGroup: z.infer<
    typeof configurationParameterGroupValidator
  > & {
    companyId: string;
    itemId: string;
  }
) {
  const { itemId, ...data } = configurationParameterGroup;
  if (configurationParameterGroup.id) {
    return client
      .from("configurationParameterGroup")
      .update({
        name: data.name
      })
      .eq("id", configurationParameterGroup.id);
  }

  const existingGroups = await client
    .from("configurationParameterGroup")
    .select("id, isUngrouped, sortOrder")
    .eq("itemId", itemId);

  const maxSortOrder =
    existingGroups.data?.reduce(
      (max, group) => Math.max(max, group.sortOrder ?? 1),
      1
    ) ?? 0;

  return client.from("configurationParameterGroup").insert({
    ...data,
    itemId,
    name: data.name,
    sortOrder: maxSortOrder + 1
  });
}

export async function upsertConfigurationRule(
  client: SupabaseClient<Database>,
  configurationRule: z.infer<typeof configurationRuleValidator> & {
    itemId: string;
    companyId: string;
    updatedBy: string;
  }
) {
  return client.from("configurationRule").upsert(configurationRule, {
    onConflict: "itemId,field"
  });
}

/**
 * Persist (or clear) the per-item shelf-life policy. Shelf life lives on the
 * "itemShelfLife" table, keyed by itemId. Absence of a row = not managed.
 *
 * Three-way mode handling so this helper can be called from any upsert path
 * safely, including forms that don't surface the shelf-life fields:
 *   - mode undefined         -> no-op. The caller's form didn't opine on
 *                               shelf life; leave whatever row exists alone.
 *   - mode 'NotManaged'      -> explicit opt-out. DELETE any existing row.
 *   - mode 'Fixed Duration' or
 *     'Calculated'           -> UPSERT, clearing fields that don't apply to
 *                               the selected mode so stale values never leak
 *                               between modes.
 *
 * Callers on an item INSERT path should pass companyId so the helper can
 * seed a fresh row without a round-trip; on an UPDATE path where we know
 * the row already exists, companyId is optional.
 */
/**
 * Persist the user's "default storage unit" pick from the item form as a
 * row in the "pickMethod" table. Items are company-wide in Carbon;
 * per-location stocking facts live on pickMethod keyed by
 * (itemId, locationId). Writing the form pick here (rather than as
 * columns on "item") respects that boundary and lets a single item
 * accumulate multiple location defaults over time.
 *
 * The locationId for the pickMethod row is derived from the chosen
 * storageUnit (every storageUnit belongs to exactly one location), so
 * the caller only needs to pass the storageUnitId. This keeps the item
 * form to a single "Default Storage Unit" field - the location is
 * implicit.
 *
 * Semantics:
 *   - storageUnitId undefined -> no-op. Forms that don't surface this
 *     field (e.g. the manufacturing sub-form) can share an action
 *     without accidentally creating or clobbering a pickMethod row.
 *   - storageUnitId set -> UPSERT on (itemId, storageUnit.locationId).
 *     Existing defaultStorageUnit for that location is overwritten with
 *     the new pick.
 */
export async function upsertItemDefaultPickMethod(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    userId: string;
    storageUnitId?: string;
  }
) {
  if (!args.storageUnitId) {
    return { data: null, error: null };
  }

  const storageUnit = await client
    .from("storageUnit")
    .select("locationId, companyId")
    .eq("id", args.storageUnitId)
    .single();
  if (storageUnit.error || !storageUnit.data) return storageUnit;

  return client.from("pickMethod").upsert(
    {
      itemId: args.itemId,
      locationId: storageUnit.data.locationId,
      defaultStorageUnitId: args.storageUnitId,
      companyId: storageUnit.data.companyId,
      createdBy: args.userId,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    },
    { onConflict: "itemId,locationId" }
  );
}

/**
 * Return the distinct processIds referenced by methodOperation rows on the
 * item's active makeMethod. Used to scope the shelf-life trigger-process
 * picker to processes the recipe will actually run, so users can't pick a
 * process the trigger never matches against (the set-shelf-life helper short-circuits
 * on processId mismatch). Empty array when the item has no active recipe.
 */
export async function getRecipeProcessIdsForItem(
  client: SupabaseClient<Database>,
  itemId: string
) {
  const makeMethod = await client
    .from("activeMakeMethods")
    .select("id")
    .eq("itemId", itemId)
    .maybeSingle();
  if (makeMethod.error || !makeMethod.data?.id) {
    return { data: [] as string[], error: makeMethod.error ?? null };
  }
  const operations = await client
    .from("methodOperation")
    .select("processId")
    .eq("makeMethodId", makeMethod.data.id);
  if (operations.error) {
    return { data: [] as string[], error: operations.error };
  }
  const ids = Array.from(
    new Set(
      (operations.data ?? [])
        .map((o) => o.processId)
        .filter((id): id is string => !!id)
    )
  );
  return { data: ids, error: null };
}

/**
 * Fetch the shelf-life policy for an item. Returns `data: null` (without
 * an error) when the item has no row, since absence = "not managed" and
 * that's a valid state we don't want to treat as an error path.
 */
export async function getItemShelfLife(
  client: SupabaseClient<Database>,
  itemId: string
) {
  return client
    .from("itemShelfLife")
    .select("mode, days, triggerProcessId, triggerTiming, calculateFromBom")
    .eq("itemId", itemId)
    .maybeSingle();
}

/**
 * Returns true when the item's active make-method has at least one BOM
 * input with a managed shelf-life policy. Used to surface a warning when
 * the user picks a BOM-driven shelf-life mode (Calculated, or Fixed
 * Duration with calculateFromBom) but no input would actually contribute
 * an expiry date.
 *
 * Returns false when there is no make-method, no materials, or every
 * material has shelf-life NotManaged. Errors are coerced to false — this
 * is a UI hint, not a correctness gate.
 */
export async function getBomHasShelfLifeManagedInput(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<boolean> {
  const makeMethods = await getMakeMethods(client, itemId, companyId);
  if (makeMethods.error || !makeMethods.data?.length) return false;

  const active =
    makeMethods.data.find((m) => m.status === "Active") ?? makeMethods.data[0];

  const materials = await getMethodMaterialsByMakeMethod(client, active.id);
  const inputItemIds = (materials.data ?? [])
    .map((m) => m.itemId)
    .filter((id): id is string => !!id);
  if (inputItemIds.length === 0) return false;

  // Any row in itemShelfLife is by definition managed - the upsert path
  // deletes the row when mode = 'NotManaged' and the column enum has no
  // such value, so presence is sufficient.
  const managed = await client
    .from("itemShelfLife")
    .select("itemId")
    .in("itemId", inputItemIds)
    .limit(1);

  return !managed.error && (managed.data?.length ?? 0) > 0;
}

export async function upsertItemShelfLife(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    userId: string;
    companyId?: string;
    mode?: (typeof shelfLifeModes)[number];
    days?: number;
    triggerProcessId?: string;
    triggerTiming?: (typeof shelfLifeTriggerTimings)[number];
    calculateFromBom?: boolean;
  }
) {
  if (args.mode === undefined) {
    return { data: null, error: null };
  }

  if (args.mode === "NotManaged") {
    return client.from("itemShelfLife").delete().eq("itemId", args.itemId);
  }

  const days = args.mode === "Fixed Duration" ? (args.days ?? null) : null;
  const triggerProcessId =
    args.mode === "Fixed Duration" ? (args.triggerProcessId ?? null) : null;
  // triggerTiming only matters when there's a trigger process. Reset to the
  // default 'After' otherwise so the column never carries a stale value
  // from a prior config.
  const triggerTiming = triggerProcessId
    ? (args.triggerTiming ?? "After")
    : "After";
  // Calculate-from-BOM is meaningful only on Fixed Duration; the table
  // CHECK enforces the same rule. Coerce any stale flag back to false on
  // mode switches so the row never carries an inconsistent combo.
  const calculateFromBom =
    args.mode === "Fixed Duration" ? (args.calculateFromBom ?? false) : false;

  // Reject trigger processes that aren't on the item's active recipe.
  // The set-shelf-life helper gates on processId equality, so a process
  // outside the recipe would never match and the expiry start date would
  // silently never get set. Mirrors the guard inside
  // upsertPickMethodWithShelfLife.
  if (triggerProcessId) {
    const recipe = await getRecipeProcessIdsForItem(client, args.itemId);
    if (recipe.error) {
      return { data: null, error: recipe.error } as any;
    }
    if (!recipe.data.includes(triggerProcessId)) {
      return {
        data: null,
        error: {
          message:
            "Shelf-life trigger process must be one of the operations on this item's recipe",
          details: "",
          hint: "",
          code: "shelf_life_trigger_process_not_in_recipe"
        }
      } as any;
    }
  }

  const existing = await client
    .from("itemShelfLife")
    .select("itemId")
    .eq("itemId", args.itemId)
    .maybeSingle();

  if (existing.error) return existing;

  if (existing.data) {
    return client
      .from("itemShelfLife")
      .update({
        mode: args.mode,
        days,
        triggerProcessId,
        triggerTiming,
        calculateFromBom,
        updatedBy: args.userId,
        updatedAt: new Date().toISOString()
      })
      .eq("itemId", args.itemId);
  }

  let companyId = args.companyId;
  if (!companyId) {
    const itemRow = await client
      .from("item")
      .select("companyId")
      .eq("id", args.itemId)
      .single();
    if (itemRow.error || !itemRow.data) return itemRow;
    companyId = itemRow.data.companyId ?? undefined;
  }

  return client.from("itemShelfLife").insert({
    itemId: args.itemId,
    mode: args.mode!,
    days,
    triggerProcessId,
    triggerTiming,
    calculateFromBom,
    companyId: companyId!,
    createdBy: args.userId
  });
}

/**
 * Atomic counterpart to {@link upsertPickMethod} + {@link upsertItemShelfLife}.
 *
 * The inventory form card submits pickMethod fields and shelf-life fields in
 * the same POST (see pickMethodWithShelfLifeValidator). Writing them through
 * two independent Supabase calls means a failure between the two leaves a
 * partial update committed. This helper runs both writes inside a single
 * Postgres transaction via Kysely.
 */
export async function upsertPickMethodWithShelfLife(
  db: Kysely<KyselyDatabase>,
  args: {
    itemId: string;
    locationId: string;
    defaultStorageUnitId?: string | null;
    sortMethod?: (typeof pickMethodSortMethods)[number];
    customFields?: Json;
    userId: string;
    shelfLife: {
      mode?: (typeof shelfLifeModes)[number];
      days?: number;
      triggerProcessId?: string;
      triggerTiming?: (typeof shelfLifeTriggerTimings)[number];
      calculateFromBom?: boolean;
    };
  }
) {
  const updatedAt = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("pickMethod")
      .set({
        defaultStorageUnitId: args.defaultStorageUnitId ?? null,
        // Only overwrite when the caller surfaced the field; the column is
        // NOT NULL DEFAULT 'Default' so we never set it null.
        ...(args.sortMethod ? { sortMethod: args.sortMethod } : {}),
        customFields: args.customFields ?? null,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "=", args.itemId)
      .where("locationId", "=", args.locationId)
      .execute();

    const { mode, days, triggerProcessId, triggerTiming, calculateFromBom } =
      args.shelfLife;

    // mode undefined = caller didn't surface the field; leave any existing
    // row alone (matches upsertItemShelfLife semantics).
    if (mode === undefined) return;

    if (mode === "NotManaged") {
      await trx
        .deleteFrom("itemShelfLife")
        .where("itemId", "=", args.itemId)
        .execute();
      return;
    }

    const normalizedDays = mode === "Fixed Duration" ? (days ?? null) : null;
    const normalizedTriggerProcess =
      mode === "Fixed Duration" ? (triggerProcessId ?? null) : null;
    const normalizedTriggerTiming = normalizedTriggerProcess
      ? (triggerTiming ?? "After")
      : "After";
    const normalizedCalcFromBom =
      mode === "Fixed Duration" ? (calculateFromBom ?? false) : false;

    // Reject trigger processes that aren't on the item's active recipe.
    // The set-shelf-life helper gates on processId equality, so picking a
    // process the recipe never runs would silently never set the expiry.
    if (normalizedTriggerProcess) {
      const recipeProcessIds = await trx
        .selectFrom("methodOperation as mo")
        .innerJoin("activeMakeMethods as amm", "amm.id", "mo.makeMethodId")
        .select("mo.processId")
        .where("amm.itemId", "=", args.itemId)
        .where("mo.processId", "is not", null)
        .execute();
      const allowed = new Set(
        recipeProcessIds
          .map((r) => r.processId)
          .filter((id): id is string => !!id)
      );
      if (!allowed.has(normalizedTriggerProcess)) {
        throw new Error(
          "Shelf-life trigger process must be one of the operations on this item's recipe"
        );
      }
    }

    const existing = await trx
      .selectFrom("itemShelfLife")
      .select("itemId")
      .where("itemId", "=", args.itemId)
      .executeTakeFirst();

    if (existing) {
      await trx
        .updateTable("itemShelfLife")
        .set({
          mode,
          days: normalizedDays,
          triggerProcessId: normalizedTriggerProcess,
          triggerTiming: normalizedTriggerTiming,
          calculateFromBom: normalizedCalcFromBom,
          updatedBy: args.userId,
          updatedAt
        })
        .where("itemId", "=", args.itemId)
        .execute();
      return;
    }

    const itemRow = await trx
      .selectFrom("item")
      .select("companyId")
      .where("id", "=", args.itemId)
      .executeTakeFirstOrThrow();

    if (!itemRow.companyId) {
      throw new Error(`Item ${args.itemId} has no companyId`);
    }

    await trx
      .insertInto("itemShelfLife")
      .values({
        itemId: args.itemId,
        mode,
        days: normalizedDays,
        triggerProcessId: normalizedTriggerProcess,
        triggerTiming: normalizedTriggerTiming,
        calculateFromBom: normalizedCalcFromBom,
        companyId: itemRow.companyId,
        createdBy: args.userId
      })
      .execute();
  });
}

/**
 * Cascades a change to item.itemTrackingType onto the snapshot columns
 * `requiresSerialTracking` and `requiresBatchTracking` on child rows that
 * belong to OPEN parents (jobs, receipts, shipments, stock transfers).
 *
 * Without this, snapshot flags drift from the live item value and leave the
 * UI reading stale (often sticky-true) tracking flags after an item is
 * flipped back to Inventory / Non-Inventory.
 */
export async function cascadeItemTrackingType(
  db: Kysely<KyselyDatabase>,
  args: {
    itemIds: string[];
    companyId: string;
    newType: InventoryItemType;
    userId: string;
  }
) {
  if (args.itemIds.length === 0) return;

  const requiresSerialTracking = args.newType === ItemTrackingType.Serial;
  const requiresBatchTracking = args.newType === ItemTrackingType.Batch;
  const updatedAt = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("jobMakeMethod")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "jobId",
          "in",
          eb
            .selectFrom("job")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "in", ["Draft", "Planned"])
        )
      )
      .execute();

    await trx
      .updateTable("jobMaterial")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "jobId",
          "in",
          eb
            .selectFrom("job")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "in", ["Draft", "Planned"])
        )
      )
      .execute();

    await trx
      .updateTable("receiptLine")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "receiptId",
          "in",
          eb
            .selectFrom("receipt")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "=", "Draft")
        )
      )
      .execute();

    await trx
      .updateTable("shipmentLine")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "shipmentId",
          "in",
          eb
            .selectFrom("shipment")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "=", "Draft")
        )
      )
      .execute();

    await trx
      .updateTable("stockTransferLine")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "stockTransferId",
          "in",
          eb
            .selectFrom("stockTransfer")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "=", "Draft")
        )
      )
      .execute();
  });
}

/**
 * Updates item-level method/sourcing columns and mirrors the change down to
 * every methodMaterial that references the item — in a single transaction, so
 * the item and its mirrors can never be left half-applied.
 *
 * sourcingType and defaultMethodType are item-level properties; method
 * materials are read-only mirrors. Only mirrors on Draft make methods are
 * touched — Active and Archived methods are frozen.
 */
export async function updateItemMethodAndSourcing(
  db: Kysely<KyselyDatabase>,
  args: {
    itemIds: string[];
    companyId: string;
    userId: string;
    itemUpdate: {
      replenishmentSystem?: Database["public"]["Enums"]["itemReplenishmentSystem"];
      defaultMethodType?: MethodType;
      sourcingType?: SourcingType;
    };
    cascade: {
      sourcingType?: SourcingType;
      methodType?: MethodType;
    };
  }
) {
  if (args.itemIds.length === 0) return;

  const updatedAt = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("item")
      .set({ ...args.itemUpdate, updatedBy: args.userId, updatedAt })
      .where("id", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .execute();

    await cascadeSourcingAndMethodTypeToMethodMaterials(trx, {
      itemIds: args.itemIds,
      companyId: args.companyId,
      userId: args.userId,
      newSourcingType: args.cascade.sourcingType,
      newMethodType: args.cascade.methodType
    });
  });
}

/**
 * Mirrors an item's sourcingType/methodType onto every methodMaterial that
 * references it. Operates on a caller-supplied transaction so it composes with
 * the item update above. Only method materials on Draft make methods are
 * touched.
 */
async function cascadeSourcingAndMethodTypeToMethodMaterials(
  trx: KyselyTx,
  args: {
    itemIds: string[];
    companyId: string;
    userId: string;
    newSourcingType?: SourcingType;
    newMethodType?: MethodType;
  }
) {
  if (args.itemIds.length === 0) return;
  if (!args.newSourcingType && !args.newMethodType) return;

  const updatedAt = datetime.timestamp();

  // Restrict to method materials whose make method is still Draft.
  const onDraftMakeMethod = (
    eb: ExpressionBuilder<KyselyDatabase, "methodMaterial">
  ) =>
    eb(
      "makeMethodId",
      "in",
      eb
        .selectFrom("makeMethod")
        .select("id")
        .where("companyId", "=", args.companyId)
        .where("status", "=", "Draft")
    );

  const baseSet: {
    updatedBy: string;
    updatedAt: string;
    sourcingType?: SourcingType;
  } = {
    updatedBy: args.userId,
    updatedAt
  };
  if (args.newSourcingType) baseSet.sourcingType = args.newSourcingType;

  await trx
    .updateTable("methodMaterial")
    .set((eb) => ({
      ...baseSet,
      ...(args.newMethodType === "Make to Order"
        ? {
            methodType: "Make to Order" as const,
            // materialMakeMethodId points at the component item's active make
            // method (mirrors upsertMethodMaterial). Resolved with a correlated
            // subquery so a single statement covers every item; null when the
            // component has no active make method.
            materialMakeMethodId: eb
              .selectFrom("activeMakeMethods")
              .select("id")
              .whereRef(
                "activeMakeMethods.itemId",
                "=",
                "methodMaterial.itemId"
              )
              .where("activeMakeMethods.companyId", "=", args.companyId)
              .limit(1)
          }
        : args.newMethodType
          ? { methodType: args.newMethodType, materialMakeMethodId: null }
          : {})
    }))
    .where("itemId", "in", args.itemIds)
    .where("companyId", "=", args.companyId)
    .where(onDraftMakeMethod)
    .execute();
}

export async function upsertConsumable(
  client: SupabaseClient<Database>,
  consumable:
    | (z.infer<typeof consumableValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof consumableValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in consumable) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: consumable.id,
        name: consumable.name,
        description: consumable.description,
        type: "Consumable",
        replenishmentSystem: consumable.replenishmentSystem,
        defaultMethodType: consumable.defaultMethodType,
        itemTrackingType: consumable.itemTrackingType,
        unitOfMeasureCode: consumable.unitOfMeasureCode,
        active: true,
        companyId: consumable.companyId,
        createdBy: consumable.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const [consumableInsert, itemCostUpdate] = await Promise.all([
      client.from("consumable").upsert({
        id: consumable.id,
        companyId: consumable.companyId,
        createdBy: consumable.createdBy,
        customFields: consumable.customFields
      }),
      client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: consumable.postingGroupId,
            unitCost: consumable.unitCost
          })
        )
        .eq("itemId", itemId)
    ]);

    if (consumableInsert.error) return consumableInsert;
    if (itemCostUpdate.error) return itemCostUpdate;

    if (itemId) {
      const pickMethod = await upsertItemDefaultPickMethod(client, {
        itemId,
        userId: consumable.createdBy,
        storageUnitId: consumable.defaultStorageUnitId
      });
      if (pickMethod.error) return pickMethod;

      const shelfLife = await upsertItemShelfLife(client, {
        itemId,
        userId: consumable.createdBy,
        companyId: consumable.companyId,
        mode: consumable.shelfLifeMode,
        days: consumable.shelfLifeDays,
        triggerProcessId: consumable.shelfLifeTriggerProcessId,
        triggerTiming: consumable.shelfLifeTriggerTiming,
        calculateFromBom: consumable.shelfLifeCalculateFromBom
      });
      if (shelfLife.error) return shelfLife;
    }

    const newConsumable = await client
      .from("consumables")
      .select("id")
      .eq("readableId", consumable.id)
      .eq("companyId", consumable.companyId)
      .single();

    return newConsumable;
  }

  const itemUpdate = {
    id: consumable.id,
    name: consumable.name,
    description: consumable.description,
    replenishmentSystem: consumable.replenishmentSystem,
    defaultMethodType: consumable.defaultMethodType,
    itemTrackingType: consumable.itemTrackingType,
    unitOfMeasureCode: consumable.unitOfMeasureCode,
    active: true
  };

  const consumableUpdate = {
    customFields: consumable.customFields
  };

  const [updateItem, updateConsumable] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: datetime.timestamp()
      })
      .eq("id", consumable.id),
    client
      .from("consumable")
      .update({
        ...sanitize(consumableUpdate),
        updatedAt: datetime.timestamp()
      })
      .eq("id", consumable.id)
  ]);

  if (updateItem.error) return updateItem;

  const pickMethod = await upsertItemDefaultPickMethod(client, {
    itemId: consumable.id,
    userId: consumable.updatedBy,
    storageUnitId: consumable.defaultStorageUnitId
  });
  if (pickMethod.error) return pickMethod;

  const shelfLife = await upsertItemShelfLife(client, {
    itemId: consumable.id,
    userId: consumable.updatedBy,
    mode: consumable.shelfLifeMode,
    days: consumable.shelfLifeDays,
    triggerProcessId: consumable.shelfLifeTriggerProcessId,
    triggerTiming: consumable.shelfLifeTriggerTiming,
    calculateFromBom: consumable.shelfLifeCalculateFromBom
  });
  if (shelfLife.error) return shelfLife;

  return updateConsumable;
}

/**
 * Best-effort match of extracted text to an existing item. Tries every
 * candidate string (e.g. an extracted part number AND description — the
 * classification doesn't matter) against the item's `readableId` then `name`,
 * case-insensitively; when nothing matches exactly, retries word-boundary
 * prefixes of each candidate against `readableId`. Returns the first item id
 * found, or null.
 *
 * Callers that also have a customer/supplier part mapping should try that
 * first; this covers the readableId/name half of the match.
 */
export async function matchItemIdByText(
  client: SupabaseClient<Database>,
  companyId: string,
  candidates: Array<string | null | undefined>
): Promise<string | null> {
  const seen = new Set<string>();
  const dedupe = (raw: string | null | undefined) => {
    const value = raw?.trim();
    if (!value) return null;
    const key = value.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    return value;
  };

  // 1. Exact match against readableId or name.
  for (const raw of candidates) {
    const value = dedupe(raw);
    if (!value) continue;

    const byReadableId = await client
      .from("item")
      .select("id")
      .eq("companyId", companyId)
      .ilike("readableId", value)
      .limit(1);
    if (byReadableId.data?.[0]) return byReadableId.data[0].id;

    const byName = await client
      .from("item")
      .select("id")
      .eq("companyId", companyId)
      .ilike("name", value)
      .limit(1);
    if (byName.data?.[0]) return byName.data[0].id;
  }

  // 2. Extracted part numbers often carry suffixes the item id doesn't (file
  // extensions, revision notes) — e.g. "LAT pole cut 1 - take 2.ai" for item
  // "LAT POLE CUT 1". Retry progressively shorter word-boundary prefixes,
  // longest first so the most specific item wins, against readableId only
  // (names are free text and too likely to collide with a description
  // fragment).
  const prefixes: string[] = [];
  for (const raw of candidates) {
    const value = raw?.trim();
    if (!value) continue;

    const withoutExtension = dedupe(value.replace(/\.[a-z]{1,5}$/i, ""));
    if (withoutExtension) prefixes.push(withoutExtension);

    // Only phrase-like text also treats dashes as word boundaries
    // ("cut 2-take 2"); a compact part number ("ABC-100-02") stays whole so
    // we never map it to a shorter dashed sibling.
    const variants = [value];
    if (/\s/.test(value) && value.includes("-")) {
      variants.push(value.replace(/-/g, " - "));
    }

    const candidatePrefixes: string[] = [];
    for (const variant of variants) {
      const words = variant.split(/\s+/);
      for (let end = words.length - 1; end > 0; end--) {
        const prefix = dedupe(
          words
            .slice(0, end)
            .join(" ")
            .replace(/[\s\-–—_:;,.]+$/, "")
        );
        if (prefix && prefix.length >= 4) candidatePrefixes.push(prefix);
      }
    }
    candidatePrefixes.sort((a, b) => b.length - a.length);
    prefixes.push(...candidatePrefixes);
  }

  for (const value of prefixes) {
    const byReadableId = await client
      .from("item")
      .select("id")
      .eq("companyId", companyId)
      .ilike("readableId", value)
      .limit(1);
    if (byReadableId.data?.[0]) return byReadableId.data[0].id;
  }

  return null;
}

/**
 * Resolve extracted document line text to an item id: first through the
 * party's part mapping (customerPartToItem / supplierPart), then by exact
 * readableId/name match. Returns null when nothing matches directly.
 */
export async function resolveItemIdFromExtractedText(
  client: SupabaseClient<Database>,
  companyId: string,
  party:
    | { type: "customer"; id: string | null | undefined }
    | { type: "supplier"; id: string | null | undefined },
  candidates: Array<string | null | undefined>
): Promise<string | null> {
  if (party.id) {
    for (const raw of candidates) {
      const candidate = raw?.trim();
      if (!candidate) continue;

      if (party.type === "customer") {
        const { data: mapping } = await client
          .from("customerPartToItem")
          .select("itemId")
          .eq("companyId", companyId)
          .eq("customerId", party.id)
          .eq("customerPartId", candidate)
          .maybeSingle();
        if (mapping) return mapping.itemId;
      } else {
        const { data: supplierPart } = await client
          .from("supplierPart")
          .select("itemId")
          .eq("companyId", companyId)
          .eq("supplierId", party.id)
          .ilike("supplierPartId", candidate)
          .limit(1);
        if (supplierPart?.[0]) return supplierPart[0].itemId;
      }
    }
  }

  return matchItemIdByText(client, companyId, candidates);
}

export async function upsertPart(
  client: SupabaseClient<Database>,
  part:
    | (z.infer<typeof partValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof partValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in part) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: part.id,
        revision: part.revision ?? "0",
        name: part.name,
        description: part.description,
        type: "Part",
        replenishmentSystem: part.replenishmentSystem,
        defaultMethodType: part.defaultMethodType,
        itemTrackingType: part.itemTrackingType,
        unitOfMeasureCode: part.unitOfMeasureCode,
        active: true,
        modelUploadId: part.modelUploadId,
        companyId: part.companyId,
        createdBy: part.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const [partInsert, itemCostUpdate] = await Promise.all([
      client.from("part").upsert({
        id: part.id,
        companyId: part.companyId,
        createdBy: part.createdBy,
        customFields: part.customFields
      }),
      client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: part.postingGroupId,
            unitCost:
              part.replenishmentSystem !== "Make" ? part.unitCost : undefined
          })
        )
        .eq("itemId", itemId)
    ]);

    if (partInsert.error) return partInsert;
    if (itemCostUpdate.error) {
      logger.error("Failed to update item cost", {
        error: itemCostUpdate.error
      });
    }

    if (part.replenishmentSystem !== "Buy") {
      const itemReplenishmentInsert = await client
        .from("itemReplenishment")
        .update({ lotSize: part.lotSize })
        .eq("itemId", itemId);

      if (itemReplenishmentInsert.error) return itemReplenishmentInsert;
    }

    if (itemId) {
      const pickMethod = await upsertItemDefaultPickMethod(client, {
        itemId,
        userId: part.createdBy,
        storageUnitId: part.defaultStorageUnitId
      });
      if (pickMethod.error) return pickMethod;

      const shelfLife = await upsertItemShelfLife(client, {
        itemId,
        userId: part.createdBy,
        companyId: part.companyId,
        mode: part.shelfLifeMode,
        days: part.shelfLifeDays,
        triggerProcessId: part.shelfLifeTriggerProcessId,
        triggerTiming: part.shelfLifeTriggerTiming,
        calculateFromBom: part.shelfLifeCalculateFromBom
      });
      if (shelfLife.error) return shelfLife;
    }

    const newPart = await client
      .from("parts")
      .select("id")
      .eq("readableId", part.id)
      .eq("companyId", part.companyId)
      .single();

    return newPart;
  }

  const itemUpdate = {
    id: part.id,
    name: part.name,
    description: part.description,
    replenishmentSystem: part.replenishmentSystem,
    defaultMethodType: part.defaultMethodType,
    itemTrackingType: part.itemTrackingType,
    unitOfMeasureCode: part.unitOfMeasureCode,
    active: true
  };

  const partUpdate = {
    customFields: part.customFields
  };

  const [updateItem, updatePart] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: datetime.timestamp()
      })
      .eq("id", part.id),
    client
      .from("part")
      .update({
        ...sanitize(partUpdate),
        updatedAt: datetime.timestamp()
      })
      .eq("id", part.id)
  ]);

  if (updateItem.error) return updateItem;

  const pickMethod = await upsertItemDefaultPickMethod(client, {
    itemId: part.id,
    userId: part.updatedBy,
    storageUnitId: part.defaultStorageUnitId
  });
  if (pickMethod.error) return pickMethod;

  const shelfLife = await upsertItemShelfLife(client, {
    itemId: part.id,
    userId: part.updatedBy,
    mode: part.shelfLifeMode,
    days: part.shelfLifeDays,
    triggerProcessId: part.shelfLifeTriggerProcessId,
    triggerTiming: part.shelfLifeTriggerTiming,
    calculateFromBom: part.shelfLifeCalculateFromBom
  });
  if (shelfLife.error) return shelfLife;

  return updatePart;
}

export async function updateItem(
  client: SupabaseClient<Database>,
  item: z.infer<typeof itemValidator> & {
    companyId: string;
    type: Database["public"]["Enums"]["itemType"];
  }
) {
  return client
    .from("item")
    .update(sanitize(item))
    .eq("id", item.id)
    .eq("companyId", item.companyId);
}

export async function upsertItemCost(
  client: SupabaseClient<Database>,
  itemCost: z.infer<typeof itemCostValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("itemCost")
    .update(sanitize(itemCost))
    .eq("itemId", itemCost.itemId);
}

export async function upsertPickMethod(
  client: SupabaseClient<Database>,
  pickMethod:
    | (z.infer<typeof pickMethodValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof pickMethodValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in pickMethod) {
    return client.from("pickMethod").upsert(pickMethod, {
      onConflict: "itemId,locationId"
    });
  }

  return client
    .from("pickMethod")
    .update(sanitize(pickMethod))
    .eq("itemId", pickMethod.itemId)
    .eq("locationId", pickMethod.locationId);
}

export async function upsertItemManufacturing(
  client: SupabaseClient<Database>,
  partManufacturing: z.infer<typeof itemManufacturingValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("itemReplenishment")
    .update(sanitize(partManufacturing))
    .eq("itemId", partManufacturing.itemId);
}

export async function upsertItemPlanning(
  client: SupabaseClient<Database>,
  partPlanning:
    | {
        companyId: string;
        itemId: string;
        locationId: string;
        createdBy: string;
      }
    | (z.infer<typeof itemPlanningValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in partPlanning) {
    return client.from("itemPlanning").insert(partPlanning);
  }
  return client
    .from("itemPlanning")
    .update(sanitize(partPlanning))
    .eq("itemId", partPlanning.itemId)
    .eq("locationId", partPlanning.locationId);
}

export async function upsertItemPurchasing(
  client: SupabaseClient<Database>,
  itemPurchasing: z.infer<typeof itemPurchasingValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  const { companyId, ...update } = itemPurchasing;

  // `purchasingUnitOfMeasureCode` and `conversionFactor` are a property of the
  // preferred supplier's supplierPart, not free-form input — the form submits
  // them only as (client-derived) hidden fields. Re-derive them server-side so
  // a forged submission can't persist a conversion factor that disagrees with
  // the supplier part (which drives PO quantities and costs). The
  // ("itemId","supplierId","companyId") unique constraint makes the lookup
  // single; `.single()` rejects a preferred supplier with no matching part.
  if (update.preferredSupplierId) {
    const supplierPart = await client
      .from("supplierPart")
      .select("supplierUnitOfMeasureCode, conversionFactor")
      .eq("companyId", companyId)
      .eq("itemId", update.itemId)
      .eq("supplierId", update.preferredSupplierId)
      .single();
    if (supplierPart.error) return supplierPart;
    update.purchasingUnitOfMeasureCode =
      supplierPart.data.supplierUnitOfMeasureCode ?? undefined;
    update.conversionFactor = supplierPart.data.conversionFactor ?? 1;
  } else {
    // No preferred supplier → identity conversion, no purchasing UoM override.
    update.purchasingUnitOfMeasureCode = undefined;
    update.conversionFactor = 1;
  }

  return client
    .from("itemReplenishment")
    .update(sanitize(update))
    .eq("itemId", update.itemId);
}

export const SUPERSESSION_CYCLE_CODE = "SUPERSESSION_CYCLE";

const SUPERSESSION_CHAIN_LIMIT = 10;

async function findSupersessionCycle(
  client: SupabaseClient<Database>,
  itemId: string,
  successorItemId: string,
  companyId: string
): Promise<
  | { kind: "ok" }
  | { kind: "cycle"; path: string[] }
  | { kind: "tooLong" }
  | { kind: "error"; error: PostgrestError }
> {
  const path = [itemId, successorItemId];
  const visited = new Set(path);
  let currentId = successorItemId;
  let closed = false;
  for (let hop = 0; hop < SUPERSESSION_CHAIN_LIMIT; hop++) {
    const link = await client
      .from("itemSupersession")
      .select("successorItemId")
      .eq("itemId", currentId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (link.error) return { kind: "error", error: link.error };
    const next = link.data?.successorItemId;
    if (!next) return { kind: "ok" };
    path.push(next);
    if (visited.has(next)) {
      closed = true;
      break;
    }
    visited.add(next);
    currentId = next;
  }
  if (!closed) return { kind: "tooLong" };

  const items = await client
    .from("item")
    .select("id, readableIdWithRevision")
    .in("id", Array.from(new Set(path)))
    .eq("companyId", companyId);
  if (items.error) return { kind: "error", error: items.error };
  const readable = new Map(
    (items.data ?? []).map((i) => [i.id, i.readableIdWithRevision ?? i.id])
  );
  return { kind: "cycle", path: path.map((id) => readable.get(id) ?? id) };
}

export async function upsertItemSupersession(
  client: SupabaseClient<Database>,
  itemSupersession: z.infer<typeof itemSupersessionValidator> & {
    companyId: string;
    createdBy: string;
    updatedBy: string;
  }
) {
  const {
    itemId,
    companyId,
    createdBy,
    updatedBy,
    supersessionMode,
    successorItemId,
    discontinuationDate,
    successorEffectivityDate,
    conversionFactor,
    locationId,
    minimumReserveQuantity
  } = itemSupersession;

  // The minimum service-stock floor is per-location, so it lives on
  // itemPlanning rather than the global supersession record.
  if (locationId && minimumReserveQuantity !== undefined) {
    const reserveUpdate = await client
      .from("itemPlanning")
      .update({ minimumReserveQuantity, updatedBy })
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId);
    if (reserveUpdate.error) return reserveUpdate;
  }

  // No mode selected = no supersession; clear any existing config.
  if (!supersessionMode) {
    return client
      .from("itemSupersession")
      .delete()
      .eq("itemId", itemId)
      .eq("companyId", companyId);
  }

  const isNoStock = supersessionMode === "No Stock";

  if (!isNoStock && successorItemId) {
    const check = await findSupersessionCycle(
      client,
      itemId,
      successorItemId,
      companyId
    );
    if (check.kind === "error") return { data: null, error: check.error };
    if (check.kind === "tooLong") {
      return {
        data: null,
        error: {
          code: SUPERSESSION_CYCLE_CODE,
          message: `Supersession chains longer than ${SUPERSESSION_CHAIN_LIMIT} hops are not allowed`
        }
      };
    }
    if (check.kind === "cycle") {
      return {
        data: null,
        error: {
          code: SUPERSESSION_CYCLE_CODE,
          message: `This would create a supersession loop: ${check.path.join(" → ")}`
        }
      };
    }
  }

  const row = {
    supersessionMode,
    // No Stock has no successor (nothing takes over the demand).
    successorItemId: isNoStock ? null : (successorItemId ?? null),
    discontinuationDate: discontinuationDate ?? null,
    successorEffectivityDate: isNoStock
      ? null
      : (successorEffectivityDate ?? null),
    conversionFactor: isNoStock ? 1 : (conversionFactor ?? 1)
  };

  const existing = await client
    .from("itemSupersession")
    .select("itemId")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (existing.data) {
    return client
      .from("itemSupersession")
      .update({ ...row, updatedBy, updatedAt: new Date().toISOString() })
      .eq("itemId", itemId)
      .eq("companyId", companyId);
  }

  return client
    .from("itemSupersession")
    .insert({ ...row, itemId, companyId, createdBy });
}

export async function upsertItemPostingGroup(
  client: SupabaseClient<Database>,
  itemPostingGroup:
    | (Omit<z.infer<typeof itemPostingGroupValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof itemPostingGroupValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in itemPostingGroup) {
    return client
      .from("itemPostingGroup")
      .insert([itemPostingGroup])
      .select("*")
      .single();
  }
  return (
    client
      .from("itemPostingGroup")
      .update(sanitize(itemPostingGroup))
      // @ts-ignore
      .eq("id", itemPostingGroup.id)
      .select("id")
      .single()
  );
}

export async function upsertSupplierPart(
  client: SupabaseClient<Database>,
  supplierPart:
    | (Omit<z.infer<typeof supplierPartValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierPartValidator>, "id"> & {
        id: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplierPart) {
    return client
      .from("supplierPart")
      .insert([supplierPart])
      .select("id")
      .single();
  }
  return client
    .from("supplierPart")
    .update(sanitize(supplierPart))
    .eq("id", supplierPart.id)
    .eq("companyId", supplierPart.companyId)
    .select("id")
    .single();
}

export async function upsertItemCustomerPart(
  client: SupabaseClient<Database>,
  customerPart:
    | (Omit<z.infer<typeof customerPartValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof customerPartValidator>, "id"> & {
        id: string;
      })
) {
  if ("id" in customerPart) {
    return client
      .from("customerPartToItem")
      .update(sanitize(customerPart))
      .eq("id", customerPart.id)
      .select("id")
      .single();
  }
  return client
    .from("customerPartToItem")
    .insert([customerPart])
    .select("id")
    .single();
}

export async function upsertItemUnitSalePrice(
  client: SupabaseClient<Database>,
  itemUnitSalePrice: z.infer<typeof itemUnitSalePriceValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("itemUnitSalePrice")
    .update(sanitize(itemUnitSalePrice))
    .eq("itemId", itemUnitSalePrice.itemId);
}

export async function upsertMakeMethodVersion(
  client: SupabaseClient<Database>,
  makeMethodVersion: z.infer<typeof makeMethodVersionValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  const currentMakeMethod = await client
    .from("makeMethod")
    .select("*")
    .eq("id", makeMethodVersion.copyFromId)
    .eq("companyId", makeMethodVersion.companyId)
    .single();

  if (currentMakeMethod.error) return currentMakeMethod;

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, version, ...data } = currentMakeMethod.data;

  const insert = await client
    .from("makeMethod")
    .insert({
      ...data,
      status: "Draft",
      version: makeMethodVersion.version,
      createdBy: makeMethodVersion.createdBy
    })
    .select("id, ...item(itemId:id, type)")
    .single();

  if (insert.error) return insert;

  if (makeMethodVersion.activeVersionId) {
    await client
      .from("makeMethod")
      .update({ status: "Active" })
      .eq("id", makeMethodVersion.activeVersionId);
  }

  return insert;
}

/**
 * On BoM material add, seed `methodMaterial.storageUnitIds` with every
 * (locationId -> defaultStorageUnitId) pair configured for the child item
 * in "pickMethod". Values set by the caller win so downstream BoMs
 * constructed with explicit picks are untouched.
 *
 * The JSONB is modelled as Record<locationId, storageUnitId>. Reading all
 * pickMethods (rather than a single "default") matches Carbon's model
 * where an item can be stocked across multiple locations, each with its
 * own preferred bin.
 */
/**
 * Coerce whatever a caller supplied for `storageUnitIds` into the
 * location → storageUnitId map the column stores. The web form pre-parses its
 * JSON string through `methodMaterialValidator`, but the MCP/API dispatch path
 * bypasses that validator and hands the service the raw value, so normalize
 * defensively here too: an object map is kept (string values only), a JSON
 * string is parsed, and null/undefined/anything-else collapses to `{}`. A bare
 * string used to be spread character-by-character into the JSONB column
 * (`"false"` → `{"0":"f","1":"a",…}`) — this is where that is stopped.
 */
function normalizeStorageUnitIds(value: unknown): Record<string, string> {
  const fromObject = (obj: Record<string, unknown>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, v] of Object.entries(obj)) {
      if (typeof v === "string") out[key] = v;
    }
    return out;
  };

  if (value == null) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? fromObject(parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return fromObject(value as Record<string, unknown>);
  }
  return {};
}

async function resolveMethodMaterialStorageUnitIds(
  client: SupabaseClient<Database>,
  args: {
    itemId?: string | null;
    current?: Record<string, string>;
  }
): Promise<Record<string, string>> {
  const current = { ...(args.current ?? {}) };
  if (!args.itemId) return current;

  const pickMethods = await client
    .from("pickMethod")
    .select("locationId, defaultStorageUnitId")
    .eq("itemId", args.itemId);

  for (const row of pickMethods.data ?? []) {
    if (
      row.locationId &&
      row.defaultStorageUnitId &&
      !current[row.locationId]
    ) {
      current[row.locationId] = row.defaultStorageUnitId;
    }
  }

  return current;
}

export async function upsertMethodMaterial(
  client: SupabaseClient<Database>,

  methodMaterial:
    | (z.infer<typeof methodMaterialValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof methodMaterialValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  // sourcingType and methodType are item-level properties (edited in the
  // item's Properties sidebar). A methodMaterial is a read-only mirror of its
  // component item, so derive both from the item rather than trusting the
  // submitted form values.
  if (methodMaterial.itemId) {
    const item = await client
      .from("item")
      .select("defaultMethodType, sourcingType")
      .eq("id", methodMaterial.itemId)
      .single();

    if (item.error) return item;
    methodMaterial.methodType =
      item.data.defaultMethodType ?? methodMaterial.methodType;
    methodMaterial.sourcingType = item.data.sourcingType;
  }

  let materialMakeMethodId: string | null = null;
  if (methodMaterial.methodType === "Make to Order") {
    const makeMethod = await client
      .from("activeMakeMethods")
      .select("id, version")
      .eq("itemId", methodMaterial.itemId!)
      .single();

    if (makeMethod.error) return makeMethod;
    materialMakeMethodId = makeMethod.data?.id;
  }

  if ("createdBy" in methodMaterial) {
    // On create, an omitted / null storageUnitIds normalizes to `{}`, then the
    // child item's default location/storage-unit picks seed any locations the
    // caller didn't specify. Respects supplied values; adds sensible defaults.
    const seededStorageUnitIds = await resolveMethodMaterialStorageUnitIds(
      client,
      {
        itemId: methodMaterial.itemId,
        current: normalizeStorageUnitIds(methodMaterial.storageUnitIds)
      }
    );
    return client
      .from("methodMaterial")
      .insert([
        {
          ...methodMaterial,
          itemId: methodMaterial.itemId!,
          storageUnitIds: seededStorageUnitIds,
          materialMakeMethodId
        }
      ])
      .select("id")
      .single();
  }
  // On update, an OMITTED storageUnitIds preserves the stored value (drop the key
  // so `sanitize` can't null it), while an explicit null / {} / map is written —
  // null and {} both clear it. The web form always submits the field, so its
  // behavior is unchanged; only the MCP/API caller can omit it.
  if (methodMaterial.storageUnitIds === undefined) {
    const { storageUnitIds: _omitted, ...preserved } = methodMaterial;
    return client
      .from("methodMaterial")
      .update(sanitize({ ...preserved, materialMakeMethodId }))
      .eq("id", methodMaterial.id)
      .select("id")
      .single();
  }
  return client
    .from("methodMaterial")
    .update(
      sanitize({
        ...methodMaterial,
        materialMakeMethodId,
        storageUnitIds: normalizeStorageUnitIds(methodMaterial.storageUnitIds)
      })
    )
    .eq("id", methodMaterial.id)
    .select("id")
    .single();
}

export async function upsertMethodOperation(
  client: SupabaseClient<Database>,

  methodOperation:
    | (Omit<z.infer<typeof methodOperationValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof methodOperationValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof methodOperationValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in methodOperation) {
    return client
      .from("methodOperation")
      .insert([normalizeOperationSourceIds(methodOperation)])
      .select("id")
      .single();
  }
  return client
    .from("methodOperation")
    .update(sanitize(normalizeOperationSourceIds(methodOperation)))
    .eq("id", methodOperation.id)
    .select("id")
    .single();
}

export async function upsertMethodOperationStep(
  client: SupabaseClient<Database>,
  methodOperationStep:
    | (Omit<z.infer<typeof operationStepValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<
        z.infer<typeof operationStepValidator>,
        "id" | "minValue" | "maxValue"
      > & {
        id: string;
        minValue: number | null;
        maxValue: number | null;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in methodOperationStep) {
    return client
      .from("methodOperationStep")
      .insert(methodOperationStep)
      .select("id")
      .single();
  }

  return client
    .from("methodOperationStep")
    .update(sanitize(methodOperationStep))
    .eq("id", methodOperationStep.id)
    .select("id")
    .single();
}

// Clone a step within the same operation: a "(copy)" appended after all siblings,
// carrying its reference slides (image + caption + size + annotations, incl. tool
// hotspots). Sequential supabase writes — a step is created first, then its slides,
// so a slide-copy failure surfaces without a half-written step blocking the editor.
export async function duplicateMethodOperationStep(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; createdBy: string }
): Promise<{ data: { id: string } | null; error: PostgrestError | null }> {
  const source = await client
    .from("methodOperationStep")
    .select("*")
    .eq("id", args.id)
    .single();
  if (source.error || !source.data) {
    return { data: null, error: source.error };
  }
  const src = source.data;

  // Append after the highest sortOrder in the operation.
  const siblings = await client
    .from("methodOperationStep")
    .select("sortOrder")
    .eq("operationId", src.operationId);
  const nextSortOrder =
    (siblings.data ?? []).reduce(
      (max, s) => Math.max(max, s.sortOrder ?? 0),
      0
    ) + 1;

  const insert = await client
    .from("methodOperationStep")
    .insert({
      operationId: src.operationId,
      name: `${src.name} (copy)`,
      description: src.description,
      type: src.type,
      unitOfMeasureCode: src.unitOfMeasureCode,
      minValue: src.minValue,
      maxValue: src.maxValue,
      listValues: src.listValues,
      sortOrder: nextSortOrder,
      companyId: args.companyId,
      createdBy: args.createdBy
    })
    .select("id")
    .single();
  if (insert.error || !insert.data) {
    return { data: null, error: insert.error };
  }
  const newStepId = insert.data.id;

  // select("*") (not an explicit column list) so `size`/`annotations` — added by the
  // step-slide migration — resolve once types are regenerated, without a bad column in
  // the select string poisoning the whole row type before then.
  const slides = await client
    .from("methodOperationStepSlide")
    .select("*")
    .eq("stepId", args.id);
  if (slides.error) {
    return { data: null, error: slides.error };
  }
  if (slides.data && slides.data.length > 0) {
    const slideRows = slides.data.map((s) => ({
      stepId: newStepId,
      imagePath: s.imagePath,
      modelUploadId: s.modelUploadId,
      caption: s.caption,
      sortOrder: s.sortOrder,
      size: s.size,
      annotations: s.annotations,
      companyId: args.companyId,
      createdBy: args.createdBy
    }));
    const slideInsert = await client
      .from("methodOperationStepSlide")
      .insert(slideRows);
    if (slideInsert.error) {
      return { data: null, error: slideInsert.error };
    }
  }

  // Copy step-scoped tool links. A tool with NO join rows is operation-level (shown on
  // every step) and needs nothing copied; only tools scoped to this specific step carry
  // a row here, and those must be repointed at the clone or the copy silently loses them.
  const toolLinks = await client
    .from("methodOperationToolStep")
    .select("methodOperationToolId")
    .eq("methodOperationStepId", args.id);
  if (toolLinks.error) {
    return { data: null, error: toolLinks.error };
  }
  if (toolLinks.data && toolLinks.data.length > 0) {
    const toolLinkInsert = await client.from("methodOperationToolStep").insert(
      toolLinks.data.map((l) => ({
        methodOperationToolId: l.methodOperationToolId,
        methodOperationStepId: newStepId
      }))
    );
    if (toolLinkInsert.error) {
      return { data: null, error: toolLinkInsert.error };
    }
  }

  // Copy step-scoped part/material links (same operation-level-vs-scoped semantics as tools).
  // Pre-migration schema: no quantity column — copy the bare links instead.
  let materialLinks = await client
    .from("methodMaterialStep")
    .select("methodMaterialId, quantity")
    .eq("methodOperationStepId", args.id);
  if (isMissingQuantityColumn(materialLinks.error)) {
    materialLinks = (await client
      .from("methodMaterialStep")
      .select("methodMaterialId")
      .eq("methodOperationStepId", args.id)) as unknown as typeof materialLinks;
  }
  if (materialLinks.error) {
    return { data: null, error: materialLinks.error };
  }
  if (materialLinks.data && materialLinks.data.length > 0) {
    const materialLinkInsert = await client.from("methodMaterialStep").insert(
      materialLinks.data.map((l) => ({
        methodMaterialId: l.methodMaterialId,
        methodOperationStepId: newStepId,
        ...(l.quantity != null ? { quantity: l.quantity } : {})
      }))
    );
    if (materialLinkInsert.error) {
      return { data: null, error: materialLinkInsert.error };
    }
  }

  return { data: { id: newStepId }, error: null };
}

export async function upsertMethodOperationStepSlide(
  client: SupabaseClient<Database>,
  slide:
    | (Omit<
        z.infer<typeof operationStepSlideValidator>,
        "id" | "annotations"
      > & {
        annotations?: z.infer<
          typeof operationStepSlideValidator
        >["annotations"];
        companyId: string;
        createdBy: string;
      })
    | (Omit<
        z.infer<typeof operationStepSlideValidator>,
        "id" | "annotations"
      > & {
        annotations?: z.infer<
          typeof operationStepSlideValidator
        >["annotations"];
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in slide) {
    return client
      .from("methodOperationStepSlide")
      .insert(slide)
      .select("id")
      .single();
  }

  return client
    .from("methodOperationStepSlide")
    .update(sanitize(slide))
    .eq("id", slide.id)
    .select("id")
    .single();
}

export async function upsertMethodOperationParameter(
  client: SupabaseClient<Database>,
  methodOperationParameter:
    | (Omit<z.infer<typeof operationParameterValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof operationParameterValidator>, "id"> & {
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in methodOperationParameter) {
    return client
      .from("methodOperationParameter")
      .insert(methodOperationParameter)
      .select("id")
      .single();
  }

  return client
    .from("methodOperationParameter")
    .update(sanitize(methodOperationParameter))
    .eq("id", methodOperationParameter.id)
    .select("id")
    .single();
}

export async function upsertMethodOperationTool(
  client: SupabaseClient<Database>,
  methodOperationTool:
    | (Omit<z.infer<typeof operationToolValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof operationToolValidator>, "id"> & {
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in methodOperationTool) {
    return client
      .from("methodOperationTool")
      .insert(methodOperationTool)
      .select("id")
      .single();
  }

  return client
    .from("methodOperationTool")
    .update(sanitize(methodOperationTool))
    .eq("id", methodOperationTool.id)
    .select("id")
    .single();
}

// Replace a method tool's step links (tool ↔ step is many-to-many). No ids = the tool
// applies to the whole operation (shown on every step in the MES). Delete-then-insert.
// Replace a method material's step links (part ↔ step, many-to-many). See above.
export async function replaceMethodMaterialSteps(
  client: SupabaseClient<Database>,
  methodMaterialId: string,
  methodOperationStepIds: string[]
) {
  // Per-step quantities are edited from the step side; a BOM-side rewrite of the
  // step set must not wipe them, so carry each retained step's quantity across
  // the delete-then-insert. Pre-migration schema: quantities don't exist, so
  // fall back to the bare link set.
  let quantityByStepId = new Map<string, number | null>();
  const existing = await client
    .from("methodMaterialStep")
    .select("methodOperationStepId, quantity")
    .eq("methodMaterialId", methodMaterialId);
  if (existing.error && !isMissingQuantityColumn(existing.error)) {
    return existing;
  }
  if (!existing.error) {
    quantityByStepId = new Map(
      (existing.data ?? []).map((l) => [l.methodOperationStepId, l.quantity])
    );
  }
  const del = await client
    .from("methodMaterialStep")
    .delete()
    .eq("methodMaterialId", methodMaterialId);
  if (del.error || methodOperationStepIds.length === 0) return del;
  return client.from("methodMaterialStep").insert(
    methodOperationStepIds.map((methodOperationStepId) => {
      const quantity = quantityByStepId.get(methodOperationStepId);
      return {
        methodMaterialId,
        methodOperationStepId,
        ...(quantity != null ? { quantity } : {})
      };
    })
  );
}

// Toggle a single part↔step link from the STEP side (the step editor's Parts picker).
// `linked` true = link the material to the step, false = unlink. Idempotent on link.
// `quantity` is the per-step share of the BOM line (NULL = the full line quantity);
// re-linking an existing link updates the quantity, so the same call edits a split.
export async function setMethodMaterialStepLink(
  client: SupabaseClient<Database>,
  args: {
    methodMaterialId: string;
    methodOperationStepId: string;
    linked: boolean;
    quantity?: number | null;
  }
) {
  if (args.linked) {
    return client.from("methodMaterialStep").upsert(
      [
        {
          methodMaterialId: args.methodMaterialId,
          methodOperationStepId: args.methodOperationStepId,
          // Omit the column when unset so the default link path still works
          // against a pre-migration schema (see isMissingQuantityColumn).
          ...(args.quantity != null ? { quantity: args.quantity } : {})
        }
      ],
      {
        onConflict: "methodMaterialId,methodOperationStepId"
      }
    );
  }
  return client
    .from("methodMaterialStep")
    .delete()
    .eq("methodMaterialId", args.methodMaterialId)
    .eq("methodOperationStepId", args.methodOperationStepId);
}

// Toggle a single tool↔step link from the STEP side (the step editor's Tools picker).
// Takes the tool ITEM id: the picker offers the whole tool library, and choosing a
// tool implicitly ensures the operation-level tool row exists (quantity 1 — the same
// row the operation's Tools tab would create) before linking it to the step. Unlink
// removes only the step link; the operation tool row stays (the Tools tab owns it).
// Twin of setMethodMaterialStepLink.
export async function setMethodOperationToolStepLink(
  client: SupabaseClient<Database>,
  args: {
    operationId: string;
    toolId: string;
    methodOperationStepId: string;
    linked: boolean;
    companyId: string;
    createdBy: string;
  }
) {
  const existingTool = await client
    .from("methodOperationTool")
    .select("id")
    .eq("operationId", args.operationId)
    .eq("toolId", args.toolId)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingTool.error) return existingTool;
  let methodOperationToolId = existingTool.data?.id;

  if (args.linked) {
    if (!methodOperationToolId) {
      const created = await client
        .from("methodOperationTool")
        .insert({
          operationId: args.operationId,
          toolId: args.toolId,
          quantity: 1,
          companyId: args.companyId,
          createdBy: args.createdBy
        })
        .select("id")
        .single();
      if (created.error) return created;
      methodOperationToolId = created.data.id;
    }
    return client.from("methodOperationToolStep").upsert(
      [
        {
          methodOperationToolId,
          methodOperationStepId: args.methodOperationStepId
        }
      ],
      {
        onConflict: "methodOperationToolId,methodOperationStepId",
        ignoreDuplicates: true
      }
    );
  }
  if (!methodOperationToolId) return { data: null, error: null };
  return client
    .from("methodOperationToolStep")
    .delete()
    .eq("methodOperationToolId", methodOperationToolId)
    .eq("methodOperationStepId", args.methodOperationStepId);
}

export async function upsertMaterial(
  client: SupabaseClient<Database>,
  material:
    | (z.infer<typeof materialValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
        sizes?: string[];
      })
    | (z.infer<typeof materialValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in material) {
    // Collect every newly-created item id across the sizes / no-sizes
    // branches so the shelf-life policy can be applied uniformly.
    const newItemIds: string[] = [];

    if (material.sizes) {
      const itemInserts = await Promise.all(
        material.sizes.map((size) =>
          client
            .from("item")
            .insert({
              readableId: material.id,
              name: material.name,
              description: material.description,
              type: "Material",
              replenishmentSystem: material.replenishmentSystem,
              defaultMethodType: material.defaultMethodType,
              itemTrackingType: material.itemTrackingType,
              unitOfMeasureCode: material.unitOfMeasureCode,
              active: true,
              revision: size,
              companyId: material.companyId,
              createdBy: material.createdBy
            })
            .select("id")
            .single()
        )
      );

      const hasErrors = itemInserts.some((insert) => insert.error);
      if (hasErrors) {
        const firstError = itemInserts.find((insert) => insert.error);
        return firstError!;
      }
      for (const insert of itemInserts) {
        if (insert.data?.id) newItemIds.push(insert.data.id);
      }
      const itemCostUpdate = await Promise.all(
        itemInserts.map((insert) =>
          client
            .from("itemCost")
            .update(
              sanitize({
                itemPostingGroupId: material.postingGroupId,
                unitCost: material.unitCost
              })
            )
            .eq("itemId", insert.data?.id ?? "")
        )
      );
      if (itemCostUpdate.some((update) => update.error)) {
        logger.error("Failed to update item cost", {
          error: itemCostUpdate.find((update) => update.error)?.error
        });
      }
    } else {
      const itemInsert = await client
        .from("item")
        .insert({
          readableId: material.id,
          name: material.name,
          description: material.description,
          type: "Material",
          replenishmentSystem: material.replenishmentSystem,
          defaultMethodType: material.defaultMethodType,
          itemTrackingType: material.itemTrackingType,
          unitOfMeasureCode: material.unitOfMeasureCode,
          active: true,
          companyId: material.companyId,
          createdBy: material.createdBy
        })
        .select("id")
        .single();
      if (itemInsert.error) return itemInsert;
      const itemId = itemInsert.data?.id;
      if (itemId) newItemIds.push(itemId);
      const itemCostUpdate = await client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: material.postingGroupId,
            unitCost: material.unitCost
          })
        )
        .eq("itemId", itemId);
      if (itemCostUpdate.error) {
        logger.error("Failed to update item cost", {
          error: itemCostUpdate.error
        });
      }
    }

    for (const itemId of newItemIds) {
      const pickMethod = await upsertItemDefaultPickMethod(client, {
        itemId,
        userId: material.createdBy,
        storageUnitId: material.defaultStorageUnitId
      });
      if (pickMethod.error) return pickMethod;

      const shelfLife = await upsertItemShelfLife(client, {
        itemId,
        userId: material.createdBy,
        companyId: material.companyId,
        mode: material.shelfLifeMode,
        days: material.shelfLifeDays,
        triggerProcessId: material.shelfLifeTriggerProcessId,
        triggerTiming: material.shelfLifeTriggerTiming,
        calculateFromBom: material.shelfLifeCalculateFromBom
      });
      if (shelfLife.error) return shelfLife;
    }

    const materialInsert = await client.from("material").upsert({
      id: material.id,
      materialFormId: material.materialFormId,
      materialSubstanceId: material.materialSubstanceId,
      finishId: material.finishId,
      gradeId: material.gradeId,
      dimensionId: material.dimensionId,
      materialTypeId: material.materialTypeId,
      companyId: material.companyId,
      createdBy: material.createdBy,
      customFields: material.customFields
    });

    if (materialInsert.error) return materialInsert;

    const newMaterial = await client
      .from("materials")
      .select("*")
      .eq("readableId", material.id)
      .eq("companyId", material.companyId);

    return {
      data: newMaterial.data?.[0] ?? null,
      error: newMaterial.error
    };
  }

  const itemUpdate = {
    id: material.id,
    name: material.name,
    description: material.description,
    replenishmentSystem: material.replenishmentSystem,
    defaultMethodType: material.defaultMethodType,
    itemTrackingType: material.itemTrackingType,
    unitOfMeasureCode: material.unitOfMeasureCode,
    active: true
  };

  const materialUpdate = {
    materialFormId: material.materialFormId,
    materialSubstanceId: material.materialSubstanceId,
    finishId: material.finishId,
    gradeId: material.gradeId,
    dimensionId: material.dimensionId,
    materialTypeId: material.materialTypeId,
    customFields: material.customFields
  };

  const [updateItem, updateMaterial] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: datetime.timestamp()
      })
      .eq("id", material.id),
    client
      .from("material")
      .update({
        ...sanitize(materialUpdate),
        updatedAt: datetime.timestamp()
      })
      .eq("id", material.id)
  ]);

  if (updateItem.error) return updateItem;

  const pickMethod = await upsertItemDefaultPickMethod(client, {
    itemId: material.id,
    userId: material.updatedBy,
    storageUnitId: material.defaultStorageUnitId
  });
  if (pickMethod.error) return pickMethod;

  const shelfLife = await upsertItemShelfLife(client, {
    itemId: material.id,
    userId: material.updatedBy,
    mode: material.shelfLifeMode,
    days: material.shelfLifeDays,
    triggerProcessId: material.shelfLifeTriggerProcessId,
    triggerTiming: material.shelfLifeTriggerTiming,
    calculateFromBom: material.shelfLifeCalculateFromBom
  });
  if (shelfLife.error) return shelfLife;

  return updateMaterial;
}

export async function upsertMaterialDimension(
  client: SupabaseClient<Database>,
  materialDimension:
    | (Omit<z.infer<typeof materialDimensionValidator>, "id"> & {
        companyId: string;
        isMetric: boolean;
      })
    | (Omit<z.infer<typeof materialDimensionValidator>, "id"> & {
        id: string;
      })
) {
  if ("id" in materialDimension) {
    return (
      client
        .from("materialDimension")
        .update(sanitize(materialDimension))
        // @ts-ignore
        .eq("id", materialDimension.id)
        .select("id")
        .single()
    );
  }

  return client
    .from("materialDimension")
    .insert([materialDimension])
    .select("*")
    .single();
}

export async function upsertMaterialFinish(
  client: SupabaseClient<Database>,
  materialFinish:
    | (Omit<z.infer<typeof materialFinishValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof materialFinishValidator>, "id"> & {
        id: string;
      })
) {
  if ("id" in materialFinish) {
    return (
      client
        .from("materialFinish")
        .update(sanitize(materialFinish))
        // @ts-ignore
        .eq("id", materialFinish.id)
        .select("id")
        .single()
    );
  }
  return client
    .from("materialFinish")
    .insert([materialFinish])
    .select("*")
    .single();
}

export async function upsertMaterialForm(
  client: SupabaseClient<Database>,
  materialForm:
    | (Omit<z.infer<typeof materialFormValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof materialFormValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in materialForm) {
    return client
      .from("materialForm")
      .insert([materialForm])
      .select("*")
      .single();
  }
  return (
    client
      .from("materialForm")
      .update(sanitize(materialForm))
      // @ts-ignore
      .eq("id", materialForm.id)
      .select("id")
      .single()
  );
}

export async function upsertMaterialGrade(
  client: SupabaseClient<Database>,
  materialGrade:
    | (Omit<z.infer<typeof materialGradeValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof materialGradeValidator>, "id"> & {
        id: string;
      })
) {
  if ("id" in materialGrade) {
    return (
      client
        .from("materialGrade")
        .update(sanitize(materialGrade))
        // @ts-ignore
        .eq("id", materialGrade.id)
        .select("id")
        .single()
    );
  }
  return client
    .from("materialGrade")
    .insert([materialGrade])
    .select("*")
    .single();
}

export async function deleteMaterialType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialType").delete().eq("id", id);
}

export async function getMaterialTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialTypes")
    .select("*", { count: "exact" })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.or(
      buildSearchFilter(args.search, [
        "name",
        "substanceName",
        "formName",
        "id"
      ])
    );
  }

  query = setGenericQueryFilters(query, args ?? {});
  return query;
}

export async function getMaterialType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialType").select("*").eq("id", id).single();
}

export async function getMaterialTypeList(
  client: SupabaseClient<Database>,
  materialSubstanceId: string,
  materialFormId: string,
  companyId: string
) {
  return client
    .from("materialType")
    .select("*")
    .eq("materialSubstanceId", materialSubstanceId)
    .eq("materialFormId", materialFormId)
    .or(`companyId.eq.${companyId},companyId.is.null`);
}

export async function upsertMaterialType(
  client: SupabaseClient<Database>,
  materialType:
    | (Omit<z.infer<typeof materialTypeValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof materialTypeValidator>, "id"> & {
        id: string;
      })
) {
  if ("id" in materialType) {
    return (
      client
        .from("materialType")
        .update(sanitize(materialType))
        // @ts-ignore
        .eq("id", materialType.id)
        .select("id")
        .single()
    );
  }
  return client
    .from("materialType")
    .insert([materialType])
    .select("*")
    .single();
}

export async function upsertMaterialSubstance(
  client: SupabaseClient<Database>,
  materialSubstance:
    | (Omit<z.infer<typeof materialSubstanceValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof materialSubstanceValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in materialSubstance) {
    return client
      .from("materialSubstance")
      .insert([materialSubstance])
      .select("*")
      .single();
  }
  return (
    client
      .from("materialSubstance")
      .update(sanitize(materialSubstance))
      // @ts-ignore
      .eq("id", materialSubstance.id)
      .select("id")
      .single()
  );
}

export async function upsertService(
  client: SupabaseClient<Database>,
  service:
    | (z.infer<typeof serviceValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof serviceValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in service) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: service.id,
        revision: service.revision ?? "0",
        name: service.name,
        description: service.description,
        type: "Service",
        replenishmentSystem: service.replenishmentSystem,
        defaultMethodType: service.defaultMethodType,
        // Services can never be shipped, received, or stocked
        itemTrackingType: "Non-Inventory",
        unitOfMeasureCode: service.unitOfMeasureCode,
        active: true,
        companyId: service.companyId,
        createdBy: service.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const [serviceInsert, itemCostUpdate] = await Promise.all([
      client.from("service").upsert({
        id: service.id,
        // Legacy column, no longer surfaced in the UI; the migration adds a
        // DB-level default of "External". Passed explicitly until the committed
        // (cloud-sourced) types pick up that default and make it optional.
        serviceType: "External",
        companyId: service.companyId,
        createdBy: service.createdBy,
        customFields: service.customFields
      }),
      client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: service.postingGroupId,
            unitCost: service.unitCost
          })
        )
        .eq("itemId", itemId)
    ]);

    if (serviceInsert.error) return serviceInsert;
    if (itemCostUpdate.error) return itemCostUpdate;

    const newService = await client
      .from("services")
      .select("*")
      .eq("readableId", service.id)
      .eq("companyId", service.companyId)
      .single();

    return newService;
  }

  const item = await client
    .from("item")
    .select("readableId, companyId")
    .eq("id", service.id)
    .single();
  if (item.error) return item;

  const itemUpdate = {
    id: service.id,
    name: service.name,
    description: service.description,
    replenishmentSystem: service.replenishmentSystem,
    defaultMethodType: service.defaultMethodType,
    itemTrackingType: "Non-Inventory" as const,
    unitOfMeasureCode: service.unitOfMeasureCode,
    active: true
  };

  const serviceUpdate = {
    customFields: service.customFields
  };

  const [updateItem, updateService] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: datetime.timestamp()
      })
      .eq("id", service.id),
    // service.id is the item uuid; the service row is keyed by readableId
    client
      .from("service")
      .update({
        ...sanitize(serviceUpdate),
        updatedAt: datetime.timestamp()
      })
      .eq("id", item.data.readableId ?? "")
      .eq("companyId", item.data.companyId ?? "")
  ]);

  if (updateItem.error) return updateItem;
  return updateService;
}

export async function upsertUnitOfMeasure(
  client: SupabaseClient<Database>,
  unitOfMeasure:
    | (Omit<z.infer<typeof unitOfMeasureValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof unitOfMeasureValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in unitOfMeasure) {
    return client
      .from("unitOfMeasure")
      .update(sanitize(unitOfMeasure))
      .eq("id", unitOfMeasure.id)
      .select("id")
      .single();
  }

  return client
    .from("unitOfMeasure")
    .insert([unitOfMeasure])
    .select("id")
    .single();
}

export async function upsertTool(
  client: SupabaseClient<Database>,
  tool:
    | (z.infer<typeof toolValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof toolValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in tool) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: tool.id,
        revision: tool.revision ?? "0",
        name: tool.name,
        description: tool.description,
        type: "Tool",
        replenishmentSystem: tool.replenishmentSystem,
        defaultMethodType: tool.defaultMethodType,
        itemTrackingType: tool.itemTrackingType,
        unitOfMeasureCode: tool.unitOfMeasureCode,
        active: true,
        modelUploadId: tool.modelUploadId,
        companyId: tool.companyId,
        createdBy: tool.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const [toolInsert, itemCostUpdate] = await Promise.all([
      client.from("tool").upsert({
        id: tool.id,
        companyId: tool.companyId,
        createdBy: tool.createdBy,
        customFields: tool.customFields
      }),
      client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: tool.postingGroupId,
            unitCost: tool.unitCost
          })
        )
        .eq("itemId", itemId)
    ]);

    if (toolInsert.error) return toolInsert;
    if (itemCostUpdate.error) return itemCostUpdate;

    if (itemId) {
      const pickMethod = await upsertItemDefaultPickMethod(client, {
        itemId,
        userId: tool.createdBy,
        storageUnitId: tool.defaultStorageUnitId
      });
      if (pickMethod.error) return pickMethod;

      const shelfLife = await upsertItemShelfLife(client, {
        itemId,
        userId: tool.createdBy,
        companyId: tool.companyId,
        mode: tool.shelfLifeMode,
        days: tool.shelfLifeDays,
        triggerProcessId: tool.shelfLifeTriggerProcessId,
        triggerTiming: tool.shelfLifeTriggerTiming,
        calculateFromBom: tool.shelfLifeCalculateFromBom
      });
      if (shelfLife.error) return shelfLife;
    }

    const newTool = await client
      .from("tools")
      .select("*")
      .eq("readableId", tool.id)
      .eq("companyId", tool.companyId)
      .single();

    return newTool;
  }

  const itemUpdate = {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    replenishmentSystem: tool.replenishmentSystem,
    defaultMethodType: tool.defaultMethodType,
    itemTrackingType: tool.itemTrackingType,
    unitOfMeasureCode: tool.unitOfMeasureCode,
    active: true
  };

  const toolUpdate = {
    customFields: tool.customFields
  };

  const [updateItem, updateTool] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: datetime.timestamp()
      })
      .eq("id", tool.id),
    client
      .from("tool")
      .update({
        ...sanitize(toolUpdate),
        updatedAt: datetime.timestamp()
      })
      .eq("id", tool.id)
  ]);

  if (updateItem.error) return updateItem;

  const pickMethod = await upsertItemDefaultPickMethod(client, {
    itemId: tool.id,
    userId: tool.updatedBy,
    storageUnitId: tool.defaultStorageUnitId
  });
  if (pickMethod.error) return pickMethod;

  const shelfLife = await upsertItemShelfLife(client, {
    itemId: tool.id,
    userId: tool.updatedBy,
    mode: tool.shelfLifeMode,
    days: tool.shelfLifeDays,
    triggerProcessId: tool.shelfLifeTriggerProcessId,
    triggerTiming: tool.shelfLifeTriggerTiming,
    calculateFromBom: tool.shelfLifeCalculateFromBom
  });
  if (shelfLife.error) return shelfLife;

  return updateTool;
}

/**
 * Batch pre-fetch supplier price breaks for multiple items.
 * Builds a SupplierPriceMap keyed by itemId, pooling price break
 * tiers from ALL suppliers for each item.
 *
 * Used by the quote loader to pre-load pricing data for BOM costing.
 */
export async function getSupplierPriceBreaksForItems(
  client: SupabaseClient<Database>,
  itemIds: string[]
): Promise<SupplierPriceMap> {
  if (!itemIds.length) return {};

  const supplierParts = await client
    .from("supplierPart")
    .select("id, itemId, unitPrice")
    .in("itemId", itemIds);

  if (!supplierParts.data?.length) return {};

  const supplierPartIds = supplierParts.data.map((sp) => sp.id);

  const prices = await client
    .from("supplierPartPrice")
    .select("supplierPartId, quantity, unitPrice")
    .in("supplierPartId", supplierPartIds)
    .order("quantity", { ascending: true });

  // Build a lookup from supplierPartId → itemId
  const spToItem = new Map<string, string>();
  for (const sp of supplierParts.data) {
    spToItem.set(sp.id, sp.itemId);
  }

  const result: SupplierPriceMap = {};

  // Initialize entries with fallback prices
  for (const sp of supplierParts.data) {
    if (!result[sp.itemId]) {
      result[sp.itemId] = { priceBreaks: [], fallbackUnitPrice: null };
    }
    const current = result[sp.itemId].fallbackUnitPrice;
    if (sp.unitPrice != null && (current === null || sp.unitPrice < current)) {
      result[sp.itemId].fallbackUnitPrice = sp.unitPrice;
    }
  }

  // Add price breaks
  for (const price of prices.data ?? []) {
    const itemId = spToItem.get(price.supplierPartId);
    if (itemId && result[itemId]) {
      result[itemId].priceBreaks.push({
        quantity: price.quantity,
        unitPrice: price.unitPrice
      });
    }
  }

  return result;
}

/**
 * Async price lookup across ALL suppliers for an item.
 * Delegates to getSupplierPriceBreaksForItems + lookupBuyPriceFromMap.
 *
 * Used in quote creation where the specific supplier isn't known.
 */
export async function lookupBuyPrice(
  client: SupabaseClient<Database>,
  itemId: string,
  qty: number,
  fallbackCost: number
): Promise<number> {
  const map = await getSupplierPriceBreaksForItems(client, [itemId]);
  return lookupBuyPriceFromMap(itemId, qty, map, fallbackCost);
}

/**
 * Fetch price breaks array for a specific supplier part.
 * Used by PO and Invoice forms to cache breaks in state.
 */
export async function getSupplierPartPriceBreaks(
  client: SupabaseClient<Database>,
  supplierPartId: string
): Promise<PriceBreak[]> {
  const result = await client
    .from("supplierPartPrice")
    .select("quantity, unitPrice")
    .eq("supplierPartId", supplierPartId)
    .order("quantity", { ascending: true });

  return (result.data ?? []).map((pb) => ({
    quantity: pb.quantity,
    unitPrice: pb.unitPrice
  }));
}
// =============================================================================
// Change Notices — header CRUD, stage transitions, list, and CO Types config.
// =============================================================================

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------
export async function getChangeNotice(
  client: SupabaseClient<Database>,
  changeNoticeId: string,
  companyId: string
) {
  return client
    .from("changeOrder")
    .select("*")
    .eq("id", changeNoticeId)
    .eq("companyId", companyId)
    .single();
}

export async function getChangeNotices(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("changeOrders")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `changeOrderId.ilike.%${args.search}%,name.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "changeOrderId", ascending: false }
    ]);
  }

  return query;
}

// -----------------------------------------------------------------------------
// Header CRUD
// -----------------------------------------------------------------------------
export async function insertChangeNotice(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    changeNoticeId?: string;
    name: string;
    type?: (typeof changeNoticeType)[number];
    priority?: (typeof nonConformancePriority)[number];
    changeNoticeTypeId?: string;
    nonConformanceId?: string;
    openDate: string;
    reasonForChange?: Json;
    description?: Json;
    dueDate?: string;
    assignee?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; changeNoticeId: string } | null;
  error: ChangeNoticeError | null;
}> {
  let changeNoticeId: string;
  if (input.changeNoticeId) {
    changeNoticeId = input.changeNoticeId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "changeOrder",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error: seq.error ?? {
          message: "Failed to generate changeOrder sequence"
        }
      };
    }
    changeNoticeId = seq.data;
  }

  const result = await client
    .from("changeOrder")
    .insert({
      changeOrderId: changeNoticeId,
      name: input.name,
      type: input.type ?? "Engineering",
      priority: input.priority ?? null,
      changeOrderTypeId: input.changeNoticeTypeId ?? null,
      nonConformanceId: input.nonConformanceId ?? null,
      openDate: input.openDate,
      reasonForChange: input.reasonForChange ?? {},
      description: input.description ?? {},
      dueDate: input.dueDate ?? null,
      assignee: input.assignee ?? null,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy
    })
    .select("id, changeOrderId")
    .single();

  if (result.error || !result.data) {
    return { data: null, error: result.error };
  }

  // No default actions are seeded on create — the CO starts with zero required
  // actions selected; the user picks them afterward from the rail's Required
  // Actions multiselect (reconciled by setChangeNoticeActionTasks).

  return {
    data: { id: result.data.id, changeNoticeId: result.data.changeOrderId },
    error: null
  };
}

export async function updateChangeNotice(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    changeOrderId?: string;
    name?: string;
    type?: (typeof changeNoticeType)[number];
    priority?: (typeof nonConformancePriority)[number] | null;
    changeOrderTypeId?: string | null;
    nonConformanceId?: string | null;
    openDate?: string;
    reasonForChange?: Json;
    description?: Json;
    dueDate?: string | null;
    assignee?: string | null;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: ChangeNoticeError | null;
}> {
  const { id, ...rest } = input;
  const result = await client
    .from("changeOrder")
    .update(sanitize(rest))
    .eq("id", id)
    .select("id")
    .single();

  if (result.error) return { data: null, error: result.error };
  return { data: { id: result.data.id }, error: null };
}

export async function deleteChangeNotice(
  db: Kysely<KyselyDatabase>,
  changeNoticeId: string,
  companyId: string
): Promise<{ data: null; error: { message: string } | null }> {
  try {
    await db.transaction().execute(async (trx) => {
      const changeNotice = await trx
        .selectFrom("changeOrder")
        .select(["id", "status"])
        .where("id", "=", changeNoticeId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!changeNotice) {
        throw new Error("Change notice not found.");
      }

      const affected = await trx
        .selectFrom("changeOrderAffectedItem")
        .select(["draftMakeMethodId", "newItemId"])
        .where("changeOrderId", "=", changeNoticeId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .execute();

      const itemIds = [
        ...new Set(
          affected
            .map(({ newItemId }) => newItemId)
            .filter((id): id is string => id !== null)
        )
      ];
      const methodIds = [
        ...new Set(
          affected
            .map(({ draftMakeMethodId }) => draftMakeMethodId)
            .filter((id): id is string => id !== null)
        )
      ];
      const itemBackedMethodIds = new Set(
        affected
          .filter(({ newItemId }) => newItemId !== null)
          .map(({ draftMakeMethodId }) => draftMakeMethodId)
          .filter((id): id is string => id !== null)
      );
      const standaloneMethodIds = new Set(
        affected
          .filter(({ newItemId }) => newItemId === null)
          .map(({ draftMakeMethodId }) => draftMakeMethodId)
          .filter((id): id is string => id !== null)
      );
      if ([...standaloneMethodIds].some((id) => itemBackedMethodIds.has(id))) {
        throw new Error("Change Notice draft references are inconsistent.");
      }

      const referencedItems =
        itemIds.length === 0
          ? []
          : await trx
              .selectFrom("item")
              .select(["id", "companyId", "changeOrderId", "active"])
              .where("id", "in", itemIds)
              .where("companyId", "=", companyId)
              .forUpdate()
              .execute();
      const referencedItemMethods =
        itemIds.length === 0
          ? []
          : await trx
              .selectFrom("makeMethod")
              .select(["id", "itemId", "companyId", "changeOrderId", "status"])
              .where("itemId", "in", itemIds)
              .where("companyId", "=", companyId)
              .forUpdate()
              .execute();
      const referencedStandaloneMethods =
        standaloneMethodIds.size === 0
          ? []
          : await trx
              .selectFrom("makeMethod")
              .select(["id", "itemId", "companyId", "changeOrderId", "status"])
              .where("id", "in", [...standaloneMethodIds])
              .where("companyId", "=", companyId)
              .forUpdate()
              .execute();

      if (referencedItems.length !== itemIds.length) {
        throw new Error("Change Notice draft references are inconsistent.");
      }

      const itemsById = new Map(referencedItems.map((item) => [item.id, item]));
      const referencedMethods = [
        ...referencedItemMethods,
        ...referencedStandaloneMethods
      ];
      const methodsById = new Map(
        referencedMethods.map((method) => [method.id, method])
      );
      if (methodIds.some((id) => !methodsById.has(id))) {
        throw new Error("Change Notice draft references are inconsistent.");
      }
      const methodsByItemId = new Map<string, typeof referencedMethods>();
      for (const method of referencedItemMethods) {
        const methods = methodsByItemId.get(method.itemId) ?? [];
        methods.push(method);
        methodsByItemId.set(method.itemId, methods);
      }

      const itemsToDelete = new Set<string>();
      const methodsToDelete = new Set<string>();
      const itemDispositionById = new Map<string, "delete" | "preserve">();

      for (const itemId of itemIds) {
        const item = itemsById.get(itemId);
        if (!item || item.changeOrderId !== changeNoticeId) {
          throw new Error("Change Notice draft references are inconsistent.");
        }

        const itemMethods = methodsByItemId.get(itemId) ?? [];
        const hasDraftMethod = itemMethods.some(
          (method) => method.status === "Draft"
        );
        const hasNonDraftMethod = itemMethods.some(
          (method) => method.status !== "Draft"
        );
        const hasForeignOwnedMethod = itemMethods.some(
          (method) =>
            method.changeOrderId !== null &&
            method.changeOrderId !== changeNoticeId
        );
        const hasOwnedNonDraftMethod = itemMethods.some(
          (method) => method.status !== "Draft" && method.changeOrderId !== null
        );

        if (
          hasForeignOwnedMethod ||
          hasOwnedNonDraftMethod ||
          (hasDraftMethod && hasNonDraftMethod)
        ) {
          throw new Error("Change Notice draft references are inconsistent.");
        }

        const shouldDelete = itemMethods.length === 0 || hasDraftMethod;
        if (shouldDelete) {
          if (changeNotice.status === "Done" || item.active !== false) {
            throw new Error("Change Notice draft references are inconsistent.");
          }
          itemDispositionById.set(itemId, "delete");
        } else {
          itemDispositionById.set(itemId, "preserve");
        }
      }

      for (const row of affected) {
        if (row.newItemId !== null) {
          const item = itemsById.get(row.newItemId);
          if (!item || item.changeOrderId !== changeNoticeId) {
            throw new Error("Change Notice draft references are inconsistent.");
          }

          if (
            row.draftMakeMethodId !== null &&
            (!methodsById.has(row.draftMakeMethodId) ||
              methodsById.get(row.draftMakeMethodId)?.itemId !== item.id)
          ) {
            throw new Error("Change Notice draft references are inconsistent.");
          }
          if (itemDispositionById.get(item.id) === "delete") {
            itemsToDelete.add(item.id);
          }
          continue;
        }

        if (row.draftMakeMethodId === null) continue;
        const method = methodsById.get(row.draftMakeMethodId);
        if (!method) {
          throw new Error("Change Notice draft references are inconsistent.");
        }
        if (
          method.changeOrderId === changeNoticeId &&
          method.status === "Draft" &&
          changeNotice.status !== "Done"
        ) {
          methodsToDelete.add(method.id);
          continue;
        }
        if (method.changeOrderId === null && method.status !== "Draft") {
          continue;
        }
        throw new Error("Change Notice draft references are inconsistent.");
      }

      if (methodsToDelete.size > 0) {
        const deleted = await trx
          .deleteFrom("makeMethod")
          .where("id", "in", [...methodsToDelete])
          .where("companyId", "=", companyId)
          .where("changeOrderId", "=", changeNoticeId)
          .where("status", "=", "Draft")
          .executeTakeFirst();
        if (Number(deleted.numDeletedRows) !== methodsToDelete.size) {
          throw new Error("Failed to delete Change Notice draft methods.");
        }
      }

      if (itemsToDelete.size > 0) {
        const deleted = await trx
          .deleteFrom("item")
          .where("id", "in", [...itemsToDelete])
          .where("companyId", "=", companyId)
          .where("changeOrderId", "=", changeNoticeId)
          .where("active", "=", false)
          .executeTakeFirst();
        if (Number(deleted.numDeletedRows) !== itemsToDelete.size) {
          throw new Error("Failed to delete Change Notice draft items.");
        }
      }

      const deleted = await trx
        .deleteFrom("changeOrder")
        .where("id", "=", changeNoticeId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (Number(deleted.numDeletedRows) !== 1) {
        throw new Error("Change Notice was not deleted.");
      }
    });

    return { data: null, error: null };
  } catch (cause) {
    return {
      data: null,
      error: {
        message:
          cause instanceof Error
            ? cause.message
            : "Failed to delete change notice."
      }
    };
  }
}

// -----------------------------------------------------------------------------
// Stage transition — the single guarded writer (G8), a compare-and-swap (G2).
// Forward-only (isAllowedChangeNoticeTransition).
// -----------------------------------------------------------------------------
export async function updateChangeNoticeStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    companyId: string;
    fromStatus: (typeof changeNoticeStatus)[number];
    toStatus: (typeof changeNoticeStatus)[number];
    assignee?: string | null;
    updatedBy: string;
  }
): Promise<{
  data: { id: string; status: (typeof changeNoticeStatus)[number] } | null;
  error: { message: string } | null;
}> {
  const { id, companyId, fromStatus, toStatus, ...rest } = update;

  if (!isAllowedChangeNoticeTransition(fromStatus, toStatus)) {
    return {
      data: null,
      error: {
        message: `Cannot change status from ${fromStatus} to ${toStatus}`
      }
    };
  }

  // Build the update explicitly rather than sanitize({...rest}): sanitize coerces
  // every `undefined` field to null, which would wipe an existing assignee on a
  // transition where the caller passes it as undefined. Only set an optional
  // field when the caller provided a value.
  const payload: {
    status: (typeof changeNoticeStatus)[number];
    updatedBy: string;
    assignee?: string | null;
  } = { status: toStatus, updatedBy: rest.updatedBy };
  if (rest.assignee !== undefined) payload.assignee = rest.assignee;

  const result = await client
    .from("changeOrder")
    .update(payload)
    .eq("id", id)
    .eq("companyId", companyId)
    .eq("status", fromStatus)
    .select("id, status")
    .maybeSingle();

  if (result.error) return { data: null, error: result.error };
  if (!result.data) {
    return {
      data: null,
      error: {
        message:
          "The change notice was updated by someone else. Refresh and try again."
      }
    };
  }
  return { data: result.data, error: null };
}

// -----------------------------------------------------------------------------
// Change Notice Types (the "Category" lookup — configured like Issue Types)
// -----------------------------------------------------------------------------
export async function getChangeNoticeTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("changeOrderType")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getChangeNoticeTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("changeOrderType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name", { ascending: true });
}

export async function getChangeNoticeType(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("changeOrderType")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function upsertChangeNoticeType(
  client: SupabaseClient<Database>,
  changeNoticeType:
    | {
        name: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      }
    | {
        id: string;
        name: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      }
) {
  if ("createdBy" in changeNoticeType) {
    return client
      .from("changeOrderType")
      .insert([changeNoticeType])
      .select("id")
      .single();
  }
  // companyId scopes the row, it is not part of the payload (it's in the PK).
  const { companyId, ...update } = changeNoticeType;
  return client
    .from("changeOrderType")
    .update(sanitize(update))
    .eq("id", changeNoticeType.id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

export async function deleteChangeNoticeType(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("changeOrderType")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// =============================================================================
// Phase 2 — Products Affected
// =============================================================================

// Joins to `item` throughout Phase 2 are done as separate FLAT scalar selects +
// a JS stitch rather than PostgREST embeds: an embedded select instantiates
// PostgREST's deeply-recursive relation parser, and across the module that
// pushed TS's global instantiation budget over the edge (TS2589 in unrelated
// files). Flat selects barely instantiate.

// Climb the BOM (methodMaterial → makeMethod → item) from a set of start items up
// to the top-level products — items that are used by nothing. Returns each product
// with `sourceItemIds`: which of the start items (the targeted assemblies) rolled up
// into it (provenance, for the "affected by" display). Flat queries (no PostgREST
// embeds — TS2589 budget); a per-item origin set that only grows drives a fixpoint,
// so a corrupt/cyclic BOM can't loop forever and provenance fully propagates.
// `nodeBudget` is a pure infinite-loop backstop, not a depth limit.
export async function getTopLevelProductsForItems(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
): Promise<{
  data: Array<{ productId: string; sourceItemIds: string[] }>;
  error: { message: string } | null;
}> {
  const start = [...new Set(itemIds.filter(Boolean))];
  if (start.length === 0) return { data: [], error: null };

  // origins[item] = the start items (targeted assemblies) that reach it.
  const origins = new Map<string, Set<string>>();
  for (const s of start) origins.set(s, new Set([s]));
  // parentsCache[item] = its immediate parent items (one level up), fetched once.
  const parentsCache = new Map<string, Set<string>>();
  const roots = new Map<string, Set<string>>();

  const fetchParents = async (ids: string[]) => {
    const unknown = ids.filter((id) => !parentsCache.has(id));
    if (unknown.length === 0) return;
    for (const id of unknown) parentsCache.set(id, new Set());

    const materials = await client
      .from("methodMaterial")
      .select("itemId, makeMethodId")
      .in("itemId", unknown)
      .eq("companyId", companyId);
    if (materials.error) throw materials.error;

    const makeMethodIds = [
      ...new Set((materials.data ?? []).map((m) => m.makeMethodId))
    ];
    const parentByMethod = new Map<string, string>();
    if (makeMethodIds.length > 0) {
      const methods = await client
        .from("makeMethod")
        .select("id, itemId")
        .in("id", makeMethodIds)
        .eq("companyId", companyId);
      if (methods.error) throw methods.error;
      for (const mm of methods.data ?? []) parentByMethod.set(mm.id, mm.itemId);
    }
    for (const row of materials.data ?? []) {
      const parent = parentByMethod.get(row.makeMethodId);
      if (parent) parentsCache.get(row.itemId)?.add(parent);
    }
  };

  let queue = [...start];
  let nodeBudget = 20000;
  try {
    while (queue.length > 0 && nodeBudget > 0) {
      const batch = [...new Set(queue)];
      queue = [];
      nodeBudget -= batch.length;
      await fetchParents(batch);

      for (const id of batch) {
        const parents = parentsCache.get(id);
        const idOrigins = origins.get(id) ?? new Set<string>();

        if (!parents || parents.size === 0) {
          // used by nothing → a top-level product; record its origins
          if (!roots.has(id)) roots.set(id, new Set());
          const rootOrigins = roots.get(id)!;
          for (const o of idOrigins) rootOrigins.add(o);
          continue;
        }

        for (const parent of parents) {
          if (!origins.has(parent)) origins.set(parent, new Set());
          const target = origins.get(parent)!;
          const before = target.size;
          for (const o of idOrigins) target.add(o);
          // Re-enqueue when the parent's origin set grew (monotonic, finite → the
          // loop terminates even on cyclic data) so provenance fully propagates.
          if (target.size > before) queue.push(parent);
        }
      }
    }
  } catch (err) {
    return { data: [], error: { message: (err as Error).message } };
  }

  return {
    data: [...roots.entries()].map(([productId, srcs]) => ({
      productId,
      sourceItemIds: [...srcs]
    })),
    error: null
  };
}

// G3 — forward-reference to a not-yet-synced part. Mints a REAL item row
// (active=false, revisionStatus='Design') through the standard item shape so
// `changeOrderStagedMaterial.itemId` is always non-null and no placeholder branch
// is threaded downstream. Onshape sync reconciles by matching readableId+company
// (flip active, fill details). A cancelled CO can leave an inactive stub — it's
// filterable and tied to the CO, far cheaper than nullable-threading everywhere.
export async function mintPlaceholderPart(
  client: SupabaseClient<Database>,
  input: {
    readableId: string;
    name: string;
    companyId: string;
    createdBy: string;
    unitOfMeasureCode?: string;
  }
): Promise<{
  data: { id: string } | null;
  error: ChangeNoticeError | null;
}> {
  const item = await client
    .from("item")
    .insert({
      readableId: input.readableId,
      revision: "0",
      name: input.name,
      type: "Part",
      replenishmentSystem: "Buy",
      defaultMethodType: "Pull from Inventory",
      itemTrackingType: "Inventory",
      unitOfMeasureCode: input.unitOfMeasureCode ?? "EA",
      active: false,
      revisionStatus: "Design",
      companyId: input.companyId,
      createdBy: input.createdBy
    })
    .select("id")
    .single();

  if (item.error || !item.data) return { data: null, error: item.error };

  const part = await client.from("part").insert({
    id: input.readableId,
    companyId: input.companyId,
    createdBy: input.createdBy
  });
  if (part.error) return { data: null, error: part.error };

  return { data: { id: item.data.id }, error: null };
}

// =============================================================================
// v2 — CO-owned Draft make-method orchestration (affected items).
//
// A CO's edits for one affected item live on a REAL Draft makeMethod owned by
// the CO (makeMethod.changeOrderId set). That draft is shown/edited both in the
// CO workspace and on the affected item's own master page (same rows, in sync);
// changeOrderId is cleared at release. Creating an affected item spins that
// draft per the change type:
//   Version  → new Draft method version on the SAME item (BoM/BoP edits).
//   Revision → new inactive revision item + its Draft method (attrs/docs).
//   New Part → new inactive part number (new readableId) + copied Draft method.
// All three keep the user client (the release path uses the same client for the
// same privileged method helpers — see applyChangeNotice / items.server).
// =============================================================================

// Mint the next readableId for a CO-derived New Part, following the SAME numbering
// scheme as the source part — so "GA-0029" yields "GA-0030", not a bare number.
// Server-side mirror of useNextItemId: split the source readableId into its
// non-numeric prefix + trailing number, ask the matching sequence RPC for the
// current MAX with that shape, then increment + zero-pad to the same width.
// Falls back to a plain numeric id when the source has no prefix.
async function getNextItemIdFromSource(
  client: SupabaseClient<Database>,
  companyId: string,
  itemType: Database["public"]["Enums"]["itemType"],
  sourceReadableId: string
): Promise<string> {
  const prefix = sourceReadableId.match(/^(.*?)\d+$/)?.[1] ?? "";

  const rpc = prefix
    ? await client.rpc("get_next_prefixed_sequence", {
        company_id: companyId,
        item_type: itemType,
        prefix
      })
    : await client.rpc("get_next_numeric_sequence", {
        company_id: companyId,
        item_type: itemType
      });

  const current = rpc.data;
  const sequence = current?.slice(prefix.length) ?? "";
  const currentSequence = parseInt(sequence, 10);
  if (!current || Number.isNaN(currentSequence)) {
    return `${prefix}${(1).toString().padStart(9, "0")}`;
  }
  // Preserve the source's digit width (mirrors useNextItemId's pad math).
  const tail = current.split(`${currentSequence}`)?.[1]?.length ?? 0;
  const width = Math.max(sequence.length - tail, 1);
  return `${prefix}${(currentSequence + 1).toString().padStart(width, "0")}`;
}

// Resolve the current Active make method id for an item (the base the draft is
// copied from + the merge base at release). Falls back to the highest version.
// Also returns `maxVersion` = the highest version number across ALL of the
// item's methods (Draft/Active/Archived) — a new draft must be numbered above
// this, not above the Active one, so parallel COs on the same item don't collide
// on the `(itemId, version)` unique constraint (a hidden CO draft already holds
// Active+1).
async function getActiveMakeMethodId(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<{
  id: string;
  version: number;
  maxVersion: number;
  // `status` of the chosen method. Since `chosen = active ?? rows[0]`, a value of
  // "Draft" means the item has NO Active method — its current method is still an
  // un-activated draft (the common case for a Make item that never spun a v2).
  status: string;
} | null> {
  const methods = await client
    .from("makeMethod")
    .select("id, version, status")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .order("version", { ascending: false });
  const rows = methods.data ?? [];
  if (rows.length === 0) return null;
  const active = rows.find((r) => r.status === "Active");
  const chosen = active ?? rows[0];
  // rows are ordered by version DESC, so rows[0] holds the highest version.
  const maxVersion = rows[0].version ?? chosen.version ?? 1;
  return {
    id: chosen.id,
    version: chosen.version ?? 1,
    maxVersion,
    status: chosen.status
  };
}

// Fetch the (single) Draft make method for a freshly-created item — the trigger
// creates one and createRevision/copyItem populate it.
async function getDraftMakeMethodIdForItem(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<string | null> {
  const draft = await client
    .from("makeMethod")
    .select("id")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return draft.data?.id ?? null;
}

type DraftMethodResult = {
  data: {
    draftMakeMethodId: string | null;
    baseMakeMethodId: string | null;
    newItemId: string | null;
  } | null;
  error: ChangeNoticeError | null;
};

// Create the CO-owned Draft make method for an affected item per its change type.
export async function createChangeNoticeDraftMethod(
  client: SupabaseClient<Database>,
  input: {
    changeNoticeId: string;
    itemId: string;
    changeType: ChangeNoticeChangeType;
    // Optional revision label for the Revision path — when the caller already
    // knows the target revision (e.g. the value typed in the new-revision
    // modal). Omitted → the next revision is auto-computed.
    revision?: string;
    companyId: string;
    userId: string;
  }
): Promise<DraftMethodResult> {
  const { changeNoticeId, itemId, changeType, revision, companyId, userId } =
    input;

  const base = await getActiveMakeMethodId(client, itemId, companyId);

  if (changeType === "Version") {
    if (!base) {
      return {
        data: null,
        error: { message: "Item has no make method to version" }
      };
    }
    // If the item's current method is still an un-activated Draft (no Active
    // version — the common case for a Make item that never spun a v2), promote it
    // to Active as we create the CO's new draft, mirroring the make-method-tools
    // "New Version" flow. Otherwise the CO draft (numbered above the base) would
    // outrank the base draft in `activeMakeMethods` — which falls back to the
    // highest-version draft when there is no Active — and `get-method` would hand
    // the CO's UNRELEASED edits to jobs/quotes. Freezing the base as Active keeps
    // production on the current method until the CO is released.
    const activeVersionId = base.status === "Draft" ? base.id : undefined;
    // New Draft version on the same item, then copy the BoM/BoP rows (the
    // canonical new-version flow: header insert + copyMakeMethod). Number it
    // above ALL existing versions (maxVersion + 1), not the Active one, so a
    // second CO on the same part doesn't collide on (itemId, version). Retry on
    // a concurrent unique-violation by recomputing the next free version.
    let draftId: string | null = null;
    let nextVersion = base.maxVersion + 1;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await upsertMakeMethodVersion(client, {
        copyFromId: base.id,
        activeVersionId,
        version: nextVersion,
        companyId,
        createdBy: userId
      });
      if (!res.error && res.data) {
        draftId = res.data.id;
        break;
      }
      // 23505 = unique_violation (makeMethod_unique_itemId_version); a parallel
      // CO grabbed this number first — recompute the next free version + retry.
      if (res.error?.code === "23505") {
        const latest = await getActiveMakeMethodId(client, itemId, companyId);
        nextVersion = (latest?.maxVersion ?? nextVersion) + 1;
        continue;
      }
      return {
        data: null,
        error: res.error ?? { message: "Failed to create draft version" }
      };
    }
    if (!draftId) {
      return {
        data: null,
        error: { message: "Failed to create draft version" }
      };
    }
    // @ts-expect-error TS2345 - getMethodValidator flags default via edge fn
    const copy = await copyMakeMethod(client, {
      sourceId: base.id,
      targetId: draftId,
      companyId,
      userId
    });
    if (copy.error) {
      return { data: null, error: { message: "Failed to copy make method" } };
    }
    const stamp = await client
      .from("makeMethod")
      .update({ changeOrderId: changeNoticeId })
      .eq("id", draftId)
      .eq("companyId", companyId);
    if (stamp.error) return { data: null, error: stamp.error };
    return {
      data: {
        draftMakeMethodId: draftId,
        baseMakeMethodId: base.id,
        newItemId: null
      },
      error: null
    };
  }

  if (changeType === "Revision") {
    const source = await getItem(client, itemId);
    if (source.error || !source.data) {
      return { data: null, error: { message: "Item not found" } };
    }
    // Honor a caller-supplied revision label (e.g. the value typed in the
    // new-revision modal); otherwise auto-pick the next revision string across
    // the item's readableId siblings.
    let nextRevision = revision?.trim();
    if (!nextRevision) {
      const siblings = await client
        .from("item")
        .select("revision")
        .eq("readableId", source.data.readableId)
        .eq("companyId", companyId)
        .eq("type", source.data.type)
        .order("revision", { ascending: false });
      const maxRevision = siblings.data?.[0]?.revision ?? "0";
      nextRevision = getNextRevision(maxRevision);
    }

    const created = await createRevision(client, {
      item: source.data,
      revision: nextRevision,
      createdBy: userId,
      active: false
    });
    if (created.error || !created.data) {
      return { data: null, error: created.error };
    }
    const newItemId = created.data.id;
    const draftId = await getDraftMakeMethodIdForItem(
      client,
      newItemId,
      companyId
    );
    const stampItem = await client
      .from("item")
      .update({ changeOrderId: changeNoticeId })
      .eq("id", newItemId)
      .eq("companyId", companyId);
    if (stampItem.error) return { data: null, error: stampItem.error };
    if (draftId) {
      await client
        .from("makeMethod")
        .update({ changeOrderId: changeNoticeId })
        .eq("id", draftId)
        .eq("companyId", companyId);
    }
    return {
      data: {
        draftMakeMethodId: draftId,
        baseMakeMethodId: base?.id ?? null,
        newItemId
      },
      error: null
    };
  }

  if (changeType === "New Part") {
    // Net-new part — no predecessor, no supersession. addChangeNoticeAffectedItem
    // already minted the item (inactive, CO-stamped); here `itemId` IS that new
    // item. Its insert trigger created a Draft makeMethod (status default 'Draft');
    // stamp it CO-owned so it hides from version lists until release (parity with
    // Revision). No source to copy from → empty draft, no baseMakeMethodId.
    const draftId = await getDraftMakeMethodIdForItem(
      client,
      itemId,
      companyId
    );
    if (draftId) {
      const stamp = await client
        .from("makeMethod")
        .update({ changeOrderId: changeNoticeId })
        .eq("id", draftId)
        .eq("companyId", companyId);
      if (stamp.error) return { data: null, error: stamp.error };
    }
    return {
      data: {
        draftMakeMethodId: draftId,
        baseMakeMethodId: null,
        newItemId: itemId
      },
      error: null
    };
  }

  // Replacement Part — a new part number derived from + (at release) superseding
  // the affected part. This is the only remaining change type here: Version /
  // Revision / New Part all returned above, so `changeType` is narrowed to
  // "Replacement Part". ECO scope is Parts + Tools (Materials/Consumables/Services
  // excluded); reject other types rather than mint a malformed row.
  const source = await getItem(client, itemId);
  if (source.error || !source.data) {
    return { data: null, error: { message: "Item not found" } };
  }
  if (source.data.type !== "Part" && source.data.type !== "Tool") {
    return {
      data: null,
      error: {
        message: `New Part is only supported for Parts and Tools (got ${source.data.type})`
      }
    };
  }
  const newReadableId = await getNextItemIdFromSource(
    client,
    companyId,
    source.data.type,
    source.data.readableId
  );
  const newItem = await client
    .from("item")
    .insert({
      readableId: newReadableId,
      revision: "0",
      name: source.data.name,
      type: source.data.type,
      replenishmentSystem: source.data.replenishmentSystem,
      defaultMethodType: source.data.defaultMethodType,
      itemTrackingType: source.data.itemTrackingType,
      unitOfMeasureCode: source.data.unitOfMeasureCode,
      // Faithfully copy the source's attributes so the CO diff shows only the
      // user's edits, not gaps left by an incomplete copy.
      description: source.data.description,
      sourcingType: source.data.sourcingType,
      thumbnailPath: source.data.thumbnailPath,
      mpn: source.data.mpn,
      active: false,
      revisionStatus: "Design",
      changeOrderId: changeNoticeId,
      companyId,
      createdBy: userId
    })
    .select("id")
    .single();
  if (newItem.error || !newItem.data) {
    return { data: null, error: newItem.error };
  }
  const newItemId = newItem.data.id;
  const typeTable = source.data.type === "Part" ? "part" : "tool";
  const typeRow = await client
    .from(typeTable)
    .insert({ id: newReadableId, companyId, createdBy: userId });
  if (typeRow.error) return { data: null, error: typeRow.error };

  // Carry the source's item group (on itemCost) onto the new part.
  await copyItemPostingGroup(client, {
    sourceItemId: itemId,
    targetItemId: newItemId,
    companyId
  });

  // Copy the affected part's method into the new item's (trigger-created) draft.
  // @ts-expect-error TS2345 - getMethodValidator flags default via edge fn
  const copy = await copyItem(client, {
    sourceId: itemId,
    targetId: newItemId,
    companyId,
    userId
  });
  if (copy.error) {
    return { data: null, error: { message: "Failed to copy make method" } };
  }
  const draftId = await getDraftMakeMethodIdForItem(
    client,
    newItemId,
    companyId
  );
  if (draftId) {
    await client
      .from("makeMethod")
      .update({ changeOrderId: changeNoticeId })
      .eq("id", draftId)
      .eq("companyId", companyId);
  }
  return {
    data: {
      draftMakeMethodId: draftId,
      baseMakeMethodId: base?.id ?? null,
      newItemId
    },
    error: null
  };
}

// Discard an affected item's CO-owned Draft (used on change-type switch + when
// removing the affected item). Deletes the new item for Revision/New Part
// (cascades its method rows) or the Draft method for Version.
async function discardChangeNoticeDraft(
  client: SupabaseClient<Database>,
  affected: {
    draftMakeMethodId: string | null;
    newItemId: string | null;
  },
  companyId: string
): Promise<void> {
  if (affected.newItemId) {
    await client
      .from("item")
      .delete()
      .eq("id", affected.newItemId)
      .eq("companyId", companyId);
    return;
  }
  if (affected.draftMakeMethodId) {
    await client
      .from("makeMethod")
      .delete()
      .eq("id", affected.draftMakeMethodId)
      .eq("companyId", companyId);
  }
}

// Add an affected item to a CO: insert the row, then spin its CO-owned Draft
// make method per the change type and write the draft refs back. Rolls the row
// back if draft creation fails (edge-fn calls can't share one txn — G2).
export async function addChangeNoticeAffectedItem(
  client: SupabaseClient<Database>,
  input: {
    changeNoticeId: string;
    // The existing affected item (Version / Revision / Replacement Part). Omitted
    // for the net-new New Part path, where `newPart` is supplied and the item is
    // minted here.
    itemId?: string;
    changeType: ChangeNoticeChangeType;
    // Forwarded to the Revision draft path so a Revision affected item can take
    // an explicit revision label (e.g. from the new-revision modal).
    revision?: string;
    // Net-new "New Part": mint a brand-new inactive Part/Tool and add it as a New
    // Part affected item (no existing itemId, no predecessor/supersession).
    newPart?: {
      readableId: string;
      name: string;
      itemType: "Part" | "Tool";
      replenishmentSystem: "Buy" | "Make" | "Buy and Make";
      itemTrackingType?: (typeof itemTrackingTypes)[number];
    };
    companyId: string;
    userId: string;
  }
): Promise<{
  data: { id: string; draftMakeMethodId: string | null } | null;
  error: ChangeNoticeError | null;
}> {
  const { changeNoticeId, changeType, revision, newPart, companyId, userId } =
    input;
  let itemId = input.itemId;
  let effectiveChangeType: ChangeNoticeChangeType = changeType;

  if (newPart) {
    // Net-new part introduced by the CO — mint an inactive Part/Tool + its type
    // row, CO-stamped. The minted id becomes the affected item (no predecessor).
    if (newPart.itemType !== "Part" && newPart.itemType !== "Tool") {
      return {
        data: null,
        error: { message: "New Part is only supported for Parts and Tools" }
      };
    }
    const defaultMethodType =
      newPart.replenishmentSystem === "Make"
        ? "Make to Order"
        : newPart.replenishmentSystem === "Buy"
          ? "Purchase to Order"
          : "Pull from Inventory";
    const minted = await client
      .from("item")
      .insert({
        readableId: newPart.readableId,
        revision: "0",
        name: newPart.name,
        type: newPart.itemType,
        replenishmentSystem: newPart.replenishmentSystem,
        defaultMethodType,
        itemTrackingType: newPart.itemTrackingType ?? "Inventory",
        unitOfMeasureCode: "EA",
        active: false,
        revisionStatus: "Design",
        changeOrderId: changeNoticeId,
        companyId,
        createdBy: userId
      })
      .select("id")
      .single();
    if (minted.error || !minted.data) {
      return { data: null, error: minted.error };
    }
    itemId = minted.data.id;
    const typeTable = newPart.itemType === "Part" ? "part" : "tool";
    const typeRow = await client
      .from(typeTable)
      .insert({ id: newPart.readableId, companyId, createdBy: userId });
    if (typeRow.error) return { data: null, error: typeRow.error };
    effectiveChangeType = "New Part";
  }

  if (!itemId) {
    return { data: null, error: { message: "Item is required" } };
  }

  // A purchased (Buy) item has no BoM/BoP, so a Version change is a no-op —
  // default it to a Revision (part-data/docs), the meaningful change for Buy.
  if (!newPart && changeType === "Version") {
    const item = await client
      .from("item")
      .select("replenishmentSystem")
      .eq("id", itemId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (item.data?.replenishmentSystem === "Buy") {
      effectiveChangeType = "Revision";
    }
  }

  const last = await client
    .from("changeOrderAffectedItem")
    .select("sortOrder")
    .eq("changeOrderId", changeNoticeId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (last.data?.sortOrder ?? -1) + 1;

  const inserted = await client
    .from("changeOrderAffectedItem")
    .insert({
      changeOrderId: changeNoticeId,
      itemId,
      changeType: effectiveChangeType,
      sortOrder,
      companyId,
      createdBy: userId
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    return { data: null, error: inserted.error };
  }
  const affectedItemId = inserted.data.id;

  const draft = await createChangeNoticeDraftMethod(client, {
    changeNoticeId,
    itemId,
    changeType: effectiveChangeType,
    revision,
    companyId,
    userId
  });
  if (draft.error || !draft.data) {
    await client
      .from("changeOrderAffectedItem")
      .delete()
      .eq("id", affectedItemId)
      .eq("companyId", companyId);
    return { data: null, error: draft.error };
  }

  await client
    .from("changeOrderAffectedItem")
    .update({
      draftMakeMethodId: draft.data.draftMakeMethodId,
      baseMakeMethodId: draft.data.baseMakeMethodId,
      newItemId: draft.data.newItemId,
      updatedBy: userId
    })
    .eq("id", affectedItemId)
    .eq("companyId", companyId);

  return {
    data: {
      id: affectedItemId,
      draftMakeMethodId: draft.data.draftMakeMethodId
    },
    error: null
  };
}

// Switch an affected item's change type: discard its current draft and rebuild
// for the new type (Q2 — the editable surface differs per type, so edits reset).
export async function updateChangeNoticeAffectedItemChangeType(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    changeType: ChangeNoticeChangeType;
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: ChangeNoticeError | null }> {
  const { id, changeType, companyId, userId } = input;

  const affected = await client
    .from("changeOrderAffectedItem")
    .select(
      "id, changeOrderId, itemId, changeType, draftMakeMethodId, newItemId"
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (affected.error || !affected.data) {
    return { data: null, error: { message: "Affected item not found" } };
  }
  // A New Part is net-new by construction — it cannot be switched to another type,
  // nor can an existing-part change become net-new. Reject both directions.
  if (changeType === "New Part" || affected.data.changeType === "New Part") {
    return {
      data: null,
      error: { message: "New Part change type cannot be switched" }
    };
  }
  if (affected.data.changeType === changeType) {
    return { data: { id }, error: null };
  }

  // Create the replacement Draft BEFORE destroying the current one, so a failure
  // in creation or the ref swap leaves the affected row still pointing at a valid
  // (undeleted) draft instead of a dangling reference. The old draft is discarded
  // only after the swap succeeds (worst case on a late failure is an orphaned
  // draft, never a dangling ref). Capture the old refs first.
  const previousDraft = {
    draftMakeMethodId: affected.data.draftMakeMethodId,
    newItemId: affected.data.newItemId
  };

  const draft = await createChangeNoticeDraftMethod(client, {
    changeNoticeId: affected.data.changeOrderId,
    itemId: affected.data.itemId,
    changeType,
    companyId,
    userId
  });
  if (draft.error || !draft.data) {
    return { data: null, error: draft.error };
  }

  const updated = await client
    .from("changeOrderAffectedItem")
    .update({
      changeType,
      draftMakeMethodId: draft.data.draftMakeMethodId,
      baseMakeMethodId: draft.data.baseMakeMethodId,
      newItemId: draft.data.newItemId,
      updatedBy: userId
    })
    .eq("id", id)
    .eq("companyId", companyId);
  if (updated.error) return { data: null, error: updated.error };

  // Swap succeeded — now safe to discard the superseded draft.
  await discardChangeNoticeDraft(client, previousDraft, companyId);
  return { data: { id }, error: null };
}

// Update the per-item revision cutover config (mode + dates). The existence of
// the oldRev→newRev supersession is automatic at release; this only tunes it.
export async function updateChangeNoticeAffectedItemCutover(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    supersessionMode: Database["public"]["Enums"]["supersessionMode"];
    discontinuationDate?: string;
    successorEffectivityDate?: string;
    userId: string;
  }
) {
  const { id, userId, ...rest } = input;
  return client
    .from("changeOrderAffectedItem")
    .update({
      ...sanitize(rest),
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

// =============================================================================
// Affected-item + supersession reads/writes (label-stitched). Flat selects + JS
// stitch (no composite-FK PostgREST embeds — the erp TS2589 budget).
// =============================================================================

// The minimal item label rendered next to each affected item / supersession.
export type ChangeNoticeStagingItemLabel = {
  id: string;
  readableId: string;
  readableIdWithRevision: string | null;
  name: string;
  type: Database["public"]["Enums"]["itemType"];
  active: boolean;
  revisionStatus: Database["public"]["Enums"]["itemRevisionStatus"];
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
};

type ChangeNoticeAffectedItemRow =
  Database["public"]["Tables"]["changeOrderAffectedItem"]["Row"];

export type ChangeNoticeAffectedItemWithLabel = ChangeNoticeAffectedItemRow & {
  item: ChangeNoticeStagingItemLabel | null;
};

const ITEM_LABEL_COLUMNS =
  "id, readableId, readableIdWithRevision, name, type, active, revisionStatus, replenishmentSystem";

// Fetch minimal item labels for a set of ids, indexed by item id.
async function stitchItemLabels(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
): Promise<{
  labels: Map<string, ChangeNoticeStagingItemLabel>;
  error: { message: string } | null;
}> {
  const uniqueIds = [...new Set(itemIds)];
  const labels = new Map<string, ChangeNoticeStagingItemLabel>();
  if (uniqueIds.length === 0) return { labels, error: null };

  for (const batch of impactIdBatches(uniqueIds)) {
    const items = await client
      .from("item")
      .select(ITEM_LABEL_COLUMNS)
      .in("id", batch)
      .eq("companyId", companyId);

    if (items.error) return { labels, error: items.error };
    for (const it of items.data ?? [])
      labels.set(it.id, it as ChangeNoticeStagingItemLabel);
  }

  return { labels, error: null };
}

// The affected items of a CO, each stitched to a minimal item label.
export async function getChangeNoticeAffectedItems(
  client: SupabaseClient<Database>,
  changeNoticeId: string,
  companyId: string
): Promise<{
  data: ChangeNoticeAffectedItemWithLabel[];
  error: { message: string } | null;
}> {
  const affected = await fetchAllFromTable<ChangeNoticeAffectedItemRow>(
    client,
    "changeOrderAffectedItem",
    "*",
    (query) =>
      query
        .eq("changeOrderId", changeNoticeId)
        .eq("companyId", companyId)
        .order("sortOrder", { ascending: true })
        .order("createdAt", { ascending: true })
        .order("id", { ascending: true })
  );

  if (affected.error || !affected.data) {
    return {
      data: [],
      error: affected.error ?? {
        message: "Change Notice affected items are unavailable."
      }
    };
  }
  const rows = affected.data;
  if (rows.length === 0) return { data: [], error: null };

  const { labels, error } = await stitchItemLabels(
    client,
    rows.map((r) => r.itemId),
    companyId
  );
  if (error) return { data: [], error };

  return {
    data: rows.map((r) => ({ ...r, item: labels.get(r.itemId) ?? null })),
    error: null
  };
}

// Remove an affected item and reconcile any open Impact provenance in one
// transaction. Kysely bypasses RLS, so the parent, tenant, and child predicates
// are all repeated inside the transaction after the Change Notice lock.
export async function removeChangeNoticeAffectedItem(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  id: string,
  changeNoticeId: string,
  companyId: string,
  userId: string
): Promise<{ data: null; error: { message: string } | null }> {
  let draftToDiscard: {
    draftMakeMethodId: string | null;
    newItemId: string | null;
  } | null = null;

  try {
    await db.transaction().execute(async (trx) => {
      const changeNotice = await trx
        .selectFrom("changeOrder")
        .select(["id", "status"])
        .where("id", "=", changeNoticeId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!changeNotice) {
        throw new ImpactMutationRejected("Change notice not found.");
      }
      if (!canEditChangeNoticeEngineering(changeNotice.status)) {
        throw new ImpactMutationRejected(
          changeNoticeLockedMessage(changeNotice.status)
        );
      }

      // Lock order is Change Notice → decision(s) → affected item → provenance.
      // The first-assessment writer follows the same order, avoiding a
      // decision/affected-item deadlock with a concurrent scope removal.
      const openProvenanceRefs = await trx
        .selectFrom("changeOrderImpactDecisionAffectedItem as provenance")
        .innerJoin("changeOrderImpactDecision as decision", (join) =>
          join
            .onRef("decision.id", "=", "provenance.decisionId")
            .onRef("decision.companyId", "=", "provenance.companyId")
        )
        .select("provenance.decisionId")
        .where("provenance.companyId", "=", companyId)
        .where("provenance.affectedItemId", "=", id)
        .where("provenance.endedAt", "is", null)
        .where("decision.companyId", "=", companyId)
        .where("decision.changeNoticeId", "=", changeNoticeId)
        .execute();
      const decisionIds = [
        ...new Set(openProvenanceRefs.map(({ decisionId }) => decisionId))
      ];

      const decisions =
        decisionIds.length === 0
          ? []
          : await trx
              .selectFrom("changeOrderImpactDecision")
              .select([
                "id",
                "targetType",
                "targetId",
                "decisionStatus",
                "noActionReasonCode",
                "rationale",
                "resolutionNote",
                "assessmentSnapshot"
              ])
              .where("companyId", "=", companyId)
              .where("changeNoticeId", "=", changeNoticeId)
              .where("id", "in", decisionIds)
              .orderBy("id", "asc")
              .forUpdate()
              .execute();
      if (decisions.length !== decisionIds.length) {
        throw new ImpactMutationRejected(
          "Impact provenance is inconsistent for this affected item."
        );
      }

      const affected = await trx
        .selectFrom("changeOrderAffectedItem")
        .select(["id", "draftMakeMethodId", "newItemId"])
        .where("id", "=", id)
        .where("changeOrderId", "=", changeNoticeId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!affected) {
        throw new ImpactMutationRejected("Affected item not found.");
      }
      draftToDiscard = {
        draftMakeMethodId: affected.draftMakeMethodId,
        newItemId: affected.newItemId
      };
      const now = datetime.timestamp();

      if (decisionIds.length > 0) {
        const provenanceRows = await trx
          .selectFrom("changeOrderImpactDecisionAffectedItem")
          .select(["id", "decisionId"])
          .where("companyId", "=", companyId)
          .where("affectedItemId", "=", id)
          .where("decisionId", "in", decisionIds)
          .where("endedAt", "is", null)
          .orderBy("decisionId", "asc")
          .orderBy("id", "asc")
          .forUpdate()
          .execute();
        if (provenanceRows.length !== openProvenanceRefs.length) {
          throw new ImpactMutationRejected(
            "Impact provenance changed while this affected item was being removed."
          );
        }

        const decisionById = new Map(
          decisions.map((decision) => [decision.id, decision])
        );
        const endReason = "Affected item removed from Change Notice";
        await trx
          .updateTable("changeOrderImpactDecisionAffectedItem")
          .set({
            endedAt: now,
            endedBy: userId,
            endedReason: endReason,
            updatedAt: now,
            updatedBy: userId
          })
          .where("companyId", "=", companyId)
          .where(
            "id",
            "in",
            provenanceRows.map(({ id: provenanceId }) => provenanceId)
          )
          .where("endedAt", "is", null)
          .execute();

        await trx
          .insertInto("changeOrderImpactDecisionHistory")
          .values(
            provenanceRows.map(({ decisionId }) => {
              const decision = decisionById.get(decisionId);
              if (!decision) {
                throw new ImpactMutationRejected(
                  "Impact provenance is inconsistent for this affected item."
                );
              }
              return {
                companyId,
                decisionId,
                targetType: decision.targetType,
                targetId: decision.targetId,
                eventType: "Provenance ended",
                previousStatus: decision.decisionStatus,
                newStatus: decision.decisionStatus,
                previousReasonCode: decision.noActionReasonCode,
                newReasonCode: decision.noActionReasonCode,
                previousSnapshot: decision.assessmentSnapshot,
                newSnapshot: decision.assessmentSnapshot,
                rationale: endReason,
                resolutionNote: decision.resolutionNote,
                relatedAffectedItemId: id,
                priorAssessmentWasChanged: false,
                createdBy: userId,
                createdAt: now
              };
            })
          )
          .execute();
      }

      await trx
        .deleteFrom("changeOrderAffectedItem")
        .where("id", "=", id)
        .where("changeOrderId", "=", changeNoticeId)
        .where("companyId", "=", companyId)
        .execute();
    });
  } catch (cause) {
    if (!(cause instanceof ImpactMutationRejected)) {
      logger.error("Failed to remove Change Notice affected item", {
        error: cause,
        companyId,
        changeNoticeId,
        affectedItemId: id
      });
    }
    return {
      data: null,
      error: {
        message:
          cause instanceof Error
            ? cause.message
            : "Affected item removal failed."
      }
    };
  }

  if (draftToDiscard) {
    await discardChangeNoticeDraft(client, draftToDiscard, companyId);
  }
  return { data: null, error: null };
}

// =============================================================================
// Change Notices — item traceability reads (part/tool ↔ CO) and the linked-NCR
// reverse view. Kept as its own section of items.service.ts to keep each area
// focused and under the module's 1000-line budget (G4).
// =============================================================================

// G6 — the SINGLE canonical "change notices referencing this item" query,
// parameterized by status. The item-detail history (all COs), the open-CO alert
// (open statuses), and the single-open-CO guard all call this — no forked
// implementations. Spans every way a CO references an item in the top-to-bottom
// model: an affected item the user selected to change, a staged BOM component,
// a manual supersession (predecessor or successor), and the reverse link from a
// released revision (`item.changeOrderId`). Scoped by readableId so it matches
// the part across all its revisions. Flat queries + JS union (no embeds —
// TS2589 budget).
export type ChangeNoticeForItem = {
  id: string;
  changeOrderId: string;
  name: string;
  status: Database["public"]["Enums"]["changeOrderStatus"];
  changeOrderTypeId: string | null;
  createdAt: string;
};

export async function findChangeNoticesForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    statuses?: Database["public"]["Enums"]["changeOrderStatus"][];
  }
): Promise<{ data: ChangeNoticeForItem[]; error: { message: string } | null }> {
  const { itemId, companyId, statuses } = args;

  // Resolve every revision (item row) sharing this part's readableId.
  const item = await client
    .from("item")
    .select("readableId")
    .eq("id", itemId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (item.error) return { data: [], error: item.error };
  if (!item.data?.readableId) return { data: [], error: null };

  const siblings = await client
    .from("item")
    .select("id, changeOrderId")
    .eq("readableId", item.data.readableId)
    .eq("companyId", companyId);
  if (siblings.error) return { data: [], error: siblings.error };
  const itemIds = (siblings.data ?? []).map((s) => s.id);
  if (itemIds.length === 0) return { data: [], error: null };

  // Collect referencing changeOrderIds from every relation. v2: instead of a
  // staged-material mirror, "this item is a component in a CO's edited BOM" is
  // found via methodMaterial rows on CO-owned draft methods (makeMethod with a
  // non-null changeOrderId).
  const [affected, componentMaterials, predecessors, successors] =
    await Promise.all([
      client
        .from("changeOrderAffectedItem")
        .select("changeOrderId")
        .in("itemId", itemIds)
        .eq("companyId", companyId),
      client
        .from("methodMaterial")
        .select("makeMethodId")
        .in("itemId", itemIds)
        .eq("companyId", companyId),
      client
        .from("changeOrderSupersession")
        .select("changeOrderId")
        .in("predecessorItemId", itemIds)
        .eq("companyId", companyId),
      client
        .from("changeOrderSupersession")
        .select("changeOrderId")
        .in("successorItemId", itemIds)
        .eq("companyId", companyId)
    ]);
  if (affected.error) return { data: [], error: affected.error };
  if (componentMaterials.error)
    return { data: [], error: componentMaterials.error };
  if (predecessors.error) return { data: [], error: predecessors.error };
  if (successors.error) return { data: [], error: successors.error };

  // Resolve which of those make methods are CO-owned drafts.
  const makeMethodIds = [
    ...new Set(
      (componentMaterials.data ?? []).map((m) => m.makeMethodId).filter(Boolean)
    )
  ] as string[];
  const coOwnedMethods = makeMethodIds.length
    ? await client
        .from("makeMethod")
        .select("changeOrderId")
        .in("id", makeMethodIds)
        .not("changeOrderId", "is", null)
        .eq("companyId", companyId)
    : { data: [], error: null };
  if (coOwnedMethods.error) return { data: [], error: coOwnedMethods.error };

  const coIds = new Set<string>();
  for (const a of affected.data ?? []) coIds.add(a.changeOrderId);
  for (const m of coOwnedMethods.data ?? []) {
    if (m.changeOrderId) coIds.add(m.changeOrderId);
  }
  for (const p of predecessors.data ?? []) coIds.add(p.changeOrderId);
  for (const s of successors.data ?? []) coIds.add(s.changeOrderId);

  // Reverse link: a released revision points at the CO that created it.
  for (const s of siblings.data ?? []) {
    if (s.changeOrderId) coIds.add(s.changeOrderId);
  }

  if (coIds.size === 0) return { data: [], error: null };

  let query = client
    .from("changeOrder")
    .select("id, changeOrderId, name, status, changeOrderTypeId, createdAt")
    .in("id", [...coIds])
    .eq("companyId", companyId);
  if (statuses && statuses.length > 0) query = query.in("status", statuses);
  query = query.order("createdAt", { ascending: false });

  const result = await query;
  if (result.error) return { data: [], error: result.error };
  return { data: result.data ?? [], error: null };
}

// Reverse of the Linked-NCR cross-link (4a): every change notice that references
// a given non-conformance. Read-only, minimal columns; rendered on the Issue
// detail. Flat select (no embeds — TS2589 budget).
export async function getChangeNoticesForNonConformance(
  client: SupabaseClient<Database>,
  nonConformanceId: string,
  companyId: string
) {
  return client
    .from("changeOrder")
    .select("id, changeOrderId, name, status")
    .eq("nonConformanceId", nonConformanceId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

// Single-open-CO-per-part guard (V1 — no parallel change notices): the OTHER
// open change notices that already reference a part, excluding the current CO.
// Reuses the canonical G6 query at the open-status filter. A non-empty result
// means adding the part here would create a parallel open CO — the routes (and
// the staging service) reject it.
export async function findOtherOpenChangeNoticesForItem(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string; excludeChangeNoticeId: string }
): Promise<ChangeNoticeForItem[]> {
  const { data } = await findChangeNoticesForItem(client, {
    itemId: args.itemId,
    companyId: args.companyId,
    statuses: changeNoticeOpenStatuses
  });
  return data.filter((cn) => cn.id !== args.excludeChangeNoticeId);
}

// Loader data for the "Change Notices" history section + open-CO alert on an
// item detail page (part/tool/material) — the CO history for the item plus the
// type lookup used to label rows. One shared source so the detail routes don't
// each re-implement the pair of reads.
export async function getItemChangeNoticeData(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [changeNotices, changeNoticeTypes] = await Promise.all([
    findChangeNoticesForItem(client, { itemId, companyId }),
    getChangeNoticeTypesList(client, companyId)
  ]);
  return {
    changeNotices: changeNotices.data,
    changeNoticeTypes: changeNoticeTypes.data ?? []
  };
}

// =============================================================================
// Change Notices — Actions (freeform tasks; reuse changeOrderActionTask). Any
// user, any stage; non-gating. Kept as its own section of items.service.ts to
// keep each area focused and under the module's 1000-line budget (G4).
// =============================================================================
export async function getChangeNoticeActions(
  client: SupabaseClient<Database>,
  changeNoticeId: string,
  companyId: string
) {
  const result = await client
    .from("changeOrderActionTask")
    .select("*")
    .eq("changeOrderId", changeNoticeId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });

  if (result.error || !result.data) {
    return result;
  }

  const taskIds = result.data.map((t) => t.id);
  let linearMappings: Map<string, unknown> = new Map();
  let jiraMappings: Map<string, unknown> = new Map();

  if (taskIds.length > 0) {
    const [{ data: linearData }, { data: jiraData }] = await Promise.all([
      client
        .from("externalIntegrationMapping")
        .select("entityId, metadata")
        .eq("entityType", "changeOrderActionTask")
        .eq("integration", "linear")
        .eq("companyId", companyId)
        .in("entityId", taskIds),
      client
        .from("externalIntegrationMapping")
        .select("entityId, metadata")
        .eq("entityType", "changeOrderActionTask")
        .eq("integration", "jira")
        .eq("companyId", companyId)
        .in("entityId", taskIds)
    ]);

    linearMappings = new Map(
      (linearData ?? []).map((m) => [m.entityId, m.metadata])
    );
    jiraMappings = new Map(
      (jiraData ?? []).map((m) => [m.entityId, m.metadata])
    );
  }

  return {
    ...result,
    data: result.data.map((task) => ({
      ...task,
      linearIssue: linearMappings.get(task.id) ?? null,
      jiraIssue: jiraMappings.get(task.id) ?? null
    }))
  };
}

export async function updateChangeNoticeActionStatus(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    changeNoticeId: string;
    companyId: string;
    status: (typeof changeNoticeTaskStatus)[number];
    userId: string;
  }
) {
  const completedDate =
    input.status === "Completed"
      ? datetime
          .today(await getCompanyTimeZone(client, input.companyId))
          .toString()
      : null;

  return client
    .from("changeOrderActionTask")
    .update({
      status: input.status,
      completedDate,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", input.id)
    .eq("changeOrderId", input.changeNoticeId)
    .eq("companyId", input.companyId)
    .select("id")
    .single();
}

export async function updateChangeNoticeActionNotes(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    changeNoticeId: string;
    companyId: string;
    notes: Json;
    userId: string;
  }
) {
  return client
    .from("changeOrderActionTask")
    .update({
      notes: input.notes,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", input.id)
    .eq("changeOrderId", input.changeNoticeId)
    .eq("companyId", input.companyId)
    .select("id")
    .single();
}

/**
 * A Change Notice task assignee is stored as a `user` id, and `user` is a global
 * identity table — so without this check a caller could name a user who is not a
 * member of the active company. Membership lives on `userToCompany`: the browser
 * picker only offers company members, but API/MCP callers can send any id, so the
 * check has to live here rather than in the picker. `null` clears the assignee.
 */
export async function assertChangeNoticeAssigneeIsCompanyMember(
  client: SupabaseClient<Database>,
  args: { companyId: string; assignee: string | null | undefined }
): Promise<{ error: { message: string } } | null> {
  const assignee = args.assignee?.trim();
  if (!assignee) return null;

  const membership = await client
    .from("userToCompany")
    .select("userId")
    .eq("userId", assignee)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (membership.error) {
    return { error: { message: "Could not verify the task assignee." } };
  }
  if (!membership.data) {
    return {
      error: { message: "The task assignee is not a member of this company." }
    };
  }
  return null;
}

export async function updateChangeNoticeActionAssignee(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    changeNoticeId: string;
    companyId: string;
    assignee: string | null;
    userId: string;
  }
): Promise<{
  data: { id: string } | null;
  error: { message: string } | null;
}> {
  const assigneeError = await assertChangeNoticeAssigneeIsCompanyMember(
    client,
    {
      companyId: input.companyId,
      assignee: input.assignee
    }
  );
  if (assigneeError) return { data: null, error: assigneeError.error };

  return client
    .from("changeOrderActionTask")
    .update({
      assignee: input.assignee,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", input.id)
    .eq("changeOrderId", input.changeNoticeId)
    .eq("companyId", input.companyId)
    .select("id")
    .single();
}

export async function updateChangeNoticeActionDueDate(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    changeNoticeId: string;
    companyId: string;
    dueDate: string | null;
    userId: string;
  }
) {
  return client
    .from("changeOrderActionTask")
    .update({
      dueDate: input.dueDate,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", input.id)
    .eq("changeOrderId", input.changeNoticeId)
    .eq("companyId", input.companyId)
    .select("id")
    .single();
}

export async function deleteChangeNoticeAction(
  client: SupabaseClient<Database>,
  input: { id: string; changeNoticeId: string; companyId: string }
) {
  return client
    .from("changeOrderActionTask")
    .delete()
    .eq("id", input.id)
    .eq("changeOrderId", input.changeNoticeId)
    .eq("companyId", input.companyId);
}

// Bulk reorder (drag-sort) — a multi-row write, so Kysely (route passes
// getDatabaseClient()). Kysely bypasses RLS and the ids come from the request
// body, so every update is scoped to the owning change notice + company.
export async function updateChangeNoticeActionOrder(
  db: Kysely<KyselyDatabase>,
  args: {
    changeNoticeId: string;
    companyId: string;
    updates: { id: string; sortOrder: number; updatedBy: string }[];
  }
) {
  const { changeNoticeId, companyId, updates } = args;
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("changeOrderActionTask")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .where("changeOrderId", "=", changeNoticeId)
        .where("companyId", "=", companyId)
        .execute();
    }
  });
}

// =============================================================================
// Change Notice Required Actions (the configurable default-action templates the
// config CRUD page manages, and the source new change notices are seeded from).
// =============================================================================
export async function getChangeNoticeRequiredActions(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("changeOrderRequiredAction")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getChangeNoticeRequiredActionsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("changeOrderRequiredAction")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

export async function getChangeNoticeRequiredAction(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("changeOrderRequiredAction")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function upsertChangeNoticeRequiredAction(
  client: SupabaseClient<Database>,
  input: {
    id?: string;
    name: string;
    active: boolean;
    companyId: string;
    userId: string;
  }
) {
  if (input.id) {
    return client
      .from("changeOrderRequiredAction")
      .update({
        name: input.name,
        active: input.active,
        updatedBy: input.userId
      })
      .eq("id", input.id)
      .eq("companyId", input.companyId)
      .select("id")
      .single();
  }

  return client
    .from("changeOrderRequiredAction")
    .insert({
      name: input.name,
      active: input.active,
      companyId: input.companyId,
      createdBy: input.userId
    })
    .select("id")
    .single();
}

export async function deleteChangeNoticeRequiredAction(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("changeOrderRequiredAction")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

const TEMPLATE_OWNED_ACTION_TASK_ORIGIN = "Template-owned" as const;

// Reconcile a change notice's action tasks to a chosen set of required-action
// templates — the sidebar's editable "Required Actions" multiselect (mirrors
// Quality's requiredActionIds field). Templates newly selected are instantiated
// (appended); template-owned tasks that are deselected are removed. Manual and
// Impact follow-up tasks survive regardless of actionTypeId. This is a trusted
// Kysely transaction because PostgREST callers may only assign the Manual origin.
export async function setChangeNoticeActionTasks(
  db: Kysely<KyselyDatabase>,
  input: {
    changeNoticeId: string;
    requiredActionIds: string[];
    companyId: string;
    userId: string;
  }
) {
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("changeOrderActionTask")
      .select(["id", "actionTypeId", "taskOrigin", "sortOrder"])
      .where("changeOrderId", "=", input.changeNoticeId)
      .where("companyId", "=", input.companyId)
      .execute();

    const rows = existing;
    const requestedIds = Array.from(new Set(input.requiredActionIds));
    const desired = new Set(requestedIds);
    const linked = new Set(
      rows.map((r) => r.actionTypeId).filter((id): id is string => Boolean(id))
    );

    const toRemove = rows
      .filter(
        (row) =>
          row.taskOrigin === TEMPLATE_OWNED_ACTION_TASK_ORIGIN &&
          row.actionTypeId !== null &&
          !desired.has(row.actionTypeId)
      )
      .map((row) => row.id);

    if (toRemove.length > 0) {
      await trx
        .deleteFrom("changeOrderActionTask")
        .where("id", "in", toRemove)
        .where("changeOrderId", "=", input.changeNoticeId)
        .where("companyId", "=", input.companyId)
        .execute();
    }

    const toAddIds = requestedIds.filter((id) => !linked.has(id));
    if (toAddIds.length > 0) {
      const templates = await trx
        .selectFrom("changeOrderRequiredAction")
        .select(["id", "name"])
        .where("id", "in", toAddIds)
        .where("companyId", "=", input.companyId)
        .execute();
      const templatesById = new Map(
        templates.map((template) => [template.id, template])
      );
      const base = rows.reduce(
        (max, row) => Math.max(max, row.sortOrder ?? 0),
        0
      );
      const values = toAddIds
        .map((id) => templatesById.get(id))
        .filter((template): template is { id: string; name: string } =>
          Boolean(template)
        )
        .map((template, index) => ({
          changeOrderId: input.changeNoticeId,
          actionTypeId: template.id,
          name: template.name,
          status: "Pending" as const,
          sortOrder: base + index + 1,
          companyId: input.companyId,
          createdBy: input.userId,
          taskOrigin: TEMPLATE_OWNED_ACTION_TASK_ORIGIN
        }));

      if (values.length > 0) {
        await trx.insertInto("changeOrderActionTask").values(values).execute();
      }
    }
  });
}

// Instantiate one changeOrderActionTask per active template when this service is
// used. Change Notice creation intentionally does not call it; the UI chooses
// templates later. This trusted path explicitly marks every inserted task as
// Template-owned.
export async function seedDefaultChangeNoticeActions(
  db: Kysely<KyselyDatabase>,
  input: { changeNoticeId: string; companyId: string; userId: string }
) {
  return db.transaction().execute(async (trx) => {
    const templates = await trx
      .selectFrom("changeOrderRequiredAction")
      .select(["id", "name"])
      .where("companyId", "=", input.companyId)
      .where("active", "=", true)
      .orderBy("name", "asc")
      .execute();

    if (templates.length === 0) return;

    await trx
      .insertInto("changeOrderActionTask")
      .values(
        templates.map((template, index) => ({
          changeOrderId: input.changeNoticeId,
          actionTypeId: template.id,
          name: template.name,
          status: "Pending" as const,
          sortOrder: index + 1,
          companyId: input.companyId,
          createdBy: input.userId,
          taskOrigin: TEMPLATE_OWNED_ACTION_TASK_ORIGIN
        }))
      )
      .execute();
  });
}

// =============================================================================
// Change Notices — the reusable method-diff engine (Q5 git-style end-state).
//
// `diffMethod` is a PURE function (no DB access, unit-testable): it compares two
// method snapshots (a `base` = the current live method, a `target` = the CO's
// staged desired end-state) and classifies every material / operation as
// added / removed / modified / unchanged, plus a column-by-column attribute diff.
// The same shape is reused for the pre-release "tips" (staged-vs-live) and the
// post-release oldRev↔newRev redline (Task 17).
//
// `getChangeNoticeDiff` is the DB-facing wrapper: for each affected item it reads
// the current source method live + the staged rows, runs `diffMethod`, and also
// returns the manual supersession declarations. Reads are flat selects + JS
// stitch (no composite-FK PostgREST embeds — the erp TS2589 budget; see lessons).
// =============================================================================

// A plain record — DB rows are passed straight through; the engine is generic
// over the shape and only reads the compared field subset + the identity keys.
type Row = Record<string, unknown>;

// Materials are matched by identity: a staged/target row's `sourceMaterialId`
// links it to a base row's `id`. Operations use `sourceOperationId`. Operation
// CHILDREN (steps / parameters / tools) use `sourceId` (the staged child's
// pointer at the live child it was copied from; NULL ⇒ added child line).
const MATERIAL_SOURCE_KEY = "sourceMaterialId";
const OPERATION_SOURCE_KEY = "sourceOperationId";
const CHILD_SOURCE_KEY = "sourceId";

// Never compared — audit / linkage / tenancy columns. The compared set for every
// staged entity is derived as (staged row keys − this set), so adding a mirrored
// business column to a staged table automatically includes it in the diff; only
// genuine noise columns need listing here.
const IGNORED_FIELDS = new Set<string>([
  "id",
  "companyId",
  "changeOrderId",
  "affectedItemId",
  "sourceMaterialId",
  "sourceOperationId",
  "sourceId",
  "stagedOperationId",
  // v2: base and draft rows live on different real methods/operations, so these
  // linkage columns always differ and must never count as a business change.
  "makeMethodId",
  "operationId",
  // The customFields JSON bag differs as a copy artifact (null vs {}), surfacing
  // a meaningless "— → Set" on unrelated edits — never diff it as a whole column.
  "customFields",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy"
]);

// Loose equality tolerant of the numeric-string ↔ number skew that Supabase
// returns for NUMERIC columns (a live `quantity` may be `"1"` while a staged one
// is `1`). null and undefined are the same "empty" value. JSON/array columns
// (workInstruction, step description, listValues/fileTypes) are separate object
// instances on the live vs staged side, so they're compared structurally — a
// reference check would report every non-null one as changed.
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

// The business columns to compare for a matched (base, target) pair: every key
// the CO actually STAGED (the target row), minus the audit/linkage/tenancy set.
// Deriving from the staged row — not a hand-maintained per-entity list, and not
// the union with the live row — is what keeps the diff in lockstep with the
// mirrored schema: staging copies exactly the changeable columns, live rows carry
// extra columns (makeMethodId, …) that must NOT be compared against `undefined`.
function comparedFields(target: Row): string[] {
  return Object.keys(target).filter((k) => !IGNORED_FIELDS.has(k));
}

// Build the field-level change map for a matched (base, target) pair. Returns
// undefined when nothing changed.
function diffFields(
  base: Row,
  target: Row
): Record<string, { before: unknown; after: unknown }> | undefined {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of comparedFields(target)) {
    if (!valuesEqual(base[field], target[field])) {
      changed[field] = {
        before: base[field] ?? null,
        after: target[field] ?? null
      };
    }
  }
  return Object.keys(changed).length > 0 ? changed : undefined;
}

// Match target rows to base rows by the given source-pointer key, then classify.
//   - base row with no target pointing at it            ⇒ removed
//   - target row with a null/absent source pointer      ⇒ added
//   - target whose source pointer references a base row  ⇒ modified | unchanged
function diffRows(
  base: Row[],
  target: Row[],
  sourceKey: string
): MethodDiffEntry<Row>[] {
  const entries: MethodDiffEntry<Row>[] = [];

  // Index base rows by their id for O(1) lookup, and track which get matched.
  const baseById = new Map<string, Row>();
  for (const row of base) {
    const id = row.id;
    if (typeof id === "string") baseById.set(id, row);
  }
  const matchedBaseIds = new Set<string>();

  for (const targetRow of target) {
    const sourceId = targetRow[sourceKey];
    const baseRow =
      typeof sourceId === "string" ? baseById.get(sourceId) : undefined;

    if (!baseRow) {
      // No live counterpart — a newly-added line.
      entries.push({ status: "added", before: null, after: targetRow });
      continue;
    }

    matchedBaseIds.add(baseRow.id as string);
    const changedFields = diffFields(baseRow, targetRow);
    const status: MethodDiffStatus = changedFields ? "modified" : "unchanged";
    entries.push({
      status,
      before: baseRow,
      after: targetRow,
      ...(changedFields ? { changedFields } : {})
    });
  }

  // Any base row nothing pointed at was dropped from the staged end-state.
  for (const baseRow of base) {
    const id = baseRow.id;
    if (typeof id === "string" && !matchedBaseIds.has(id)) {
      entries.push({ status: "removed", before: baseRow, after: null });
    }
  }

  return entries;
}

// -----------------------------------------------------------------------------
// Operation children (steps / parameters / tools)
// -----------------------------------------------------------------------------

// The three staged child buckets for a single operation, keyed by the staged
// operation's id. Both the live (base) children and the staged (target) children
// share this shape.
export type OperationChildren = {
  steps: Row[];
  parameters: Row[];
  tools: Row[];
};

// OperationChildrenDiff and OperationDiffEntry now live in items.models
// (imported + re-exported above) so ChangeNoticeItemDiff can reference them
// without a circular import. Their shape is unchanged (Row = Record<string,
// unknown>, the same as MethodDiffEntry's generic here).

// Base/target children keyed by operation id. For target (staged) operations the
// key is the staged operation's own id; for base (live) operations it's the live
// operation's id. Matching a staged operation to its base children goes through
// the operation's `sourceOperationId`.
export type ChildrenByOperationId = Record<string, OperationChildren>;

function emptyChildren(): OperationChildren {
  return { steps: [], parameters: [], tools: [] };
}

// Diff one operation's children. `base`/`target` are the live/staged child
// buckets; each bucket is matched by `sourceId` over its own compare-field set.
function diffOperationChildren(
  base: OperationChildren,
  target: OperationChildren
): OperationChildrenDiff {
  return {
    steps: diffRows(base.steps, target.steps, CHILD_SOURCE_KEY),
    parameters: diffRows(base.parameters, target.parameters, CHILD_SOURCE_KEY),
    tools: diffRows(base.tools, target.tools, CHILD_SOURCE_KEY)
  };
}

// Diff operations AND, when child buckets are supplied, attach a per-operation
// child diff. Matches operations exactly like diffRows (by `sourceOperationId`);
// for each entry it pairs the base children (via the matched base operation id)
// with the target children (via the staged operation id) and runs
// `diffOperationChildren`. When no child maps are supplied it degrades to the
// plain operation diff (identical to `diffRows`), so existing callers/tests are
// unaffected.
function diffOperations(
  base: Row[],
  target: Row[],
  baseChildren?: ChildrenByOperationId,
  targetChildren?: ChildrenByOperationId
): OperationDiffEntry[] {
  const entries = diffRows(
    base,
    target,
    OPERATION_SOURCE_KEY
  ) as OperationDiffEntry[];

  if (!baseChildren && !targetChildren) return entries;

  for (const entry of entries) {
    const baseId = (entry.before as { id?: string } | null)?.id;
    const targetId = (entry.after as { id?: string } | null)?.id;
    const baseKids = (baseId && baseChildren?.[baseId]) || emptyChildren();
    const targetKids =
      (targetId && targetChildren?.[targetId]) || emptyChildren();
    entry.children = diffOperationChildren(baseKids, targetKids);
  }

  return entries;
}

// Column-by-column diff of two attribute objects. Every key present in either
// object (minus the ignored audit/linkage set) is compared; each changed column
// becomes one MethodDiffEntry whose `changedFields` holds the single field. When
// nothing changed a single "unchanged" entry is returned so callers can render
// "no attribute changes" uniformly.
function diffAttributes(
  base: Row | null,
  target: Row | null
): MethodDiffEntry<Row>[] {
  const b = base ?? {};
  const t = target ?? {};
  // Net-new item (a New Part has no predecessor): surface every attribute as an
  // addition — the whole item is new — mirroring how a BOM/BOP with no base
  // method renders all of its rows as `added`. The viewer draws the full property
  // list in green rather than per-field old→new pairs.
  if (!base && target) {
    return [{ status: "added", before: null, after: target }];
  }
  // Compare only the columns the CO staged (target), minus audit/linkage — the
  // live source select carries extra columns (e.g. modelUploadId) the staged row
  // doesn't mirror, and comparing those against `undefined` would be spurious.
  const keys = target ? comparedFields(target) : [];

  const entries: MethodDiffEntry<Row>[] = [];
  for (const key of keys) {
    if (valuesEqual(b[key], t[key])) continue;
    entries.push({
      status: "modified",
      before: base,
      after: target,
      changedFields: {
        [key]: { before: b[key] ?? null, after: t[key] ?? null }
      }
    });
  }

  if (entries.length === 0) {
    return [{ status: "unchanged", before: base, after: target }];
  }
  return entries;
}

// -----------------------------------------------------------------------------
// The pure diff engine
// -----------------------------------------------------------------------------

export type DiffMethodInput = {
  baseMaterials: Row[];
  targetMaterials: Row[];
  baseOperations: Row[];
  targetOperations: Row[];
  baseAttributes?: Row | null;
  targetAttributes?: Row | null;
  // Optional per-operation children (steps/parameters/tools), keyed by operation
  // id (live op id for base, staged op id for target). When omitted, operation
  // entries carry no `children` and the result is identical to the pre-Task-16
  // shape.
  baseOperationChildren?: ChildrenByOperationId;
  targetOperationChildren?: ChildrenByOperationId;
};

export type DiffMethodResult = {
  materials: MethodDiffEntry<Row>[];
  // Operations may carry an optional child-level diff (see OperationDiffEntry).
  // OperationDiffEntry is a superset of MethodDiffEntry<Row>, so consumers typed
  // against MethodDiffEntry<Row>[] keep working.
  operations: OperationDiffEntry[];
  attributes: MethodDiffEntry<Row>[];
};

// PURE. Compares two method snapshots. No DB access — the caller supplies plain
// rows (live method rows as `base`, CO-staged rows as `target`), and optionally
// the per-operation child buckets to also diff steps/parameters/tools.
export function diffMethod(input: DiffMethodInput): DiffMethodResult {
  return {
    materials: diffRows(
      input.baseMaterials,
      input.targetMaterials,
      MATERIAL_SOURCE_KEY
    ),
    operations: diffOperations(
      input.baseOperations,
      input.targetOperations,
      input.baseOperationChildren,
      input.targetOperationChildren
    ),
    attributes: diffAttributes(
      input.baseAttributes ?? null,
      input.targetAttributes ?? null
    )
  };
}

// -----------------------------------------------------------------------------
// DB-facing wrapper
// -----------------------------------------------------------------------------

export type ChangeNoticeDiff = {
  items: ChangeNoticeItemDiff[];
};

// Editable item attribute columns compared for the attribute diff. `mpn` lives on
// item; the item group (itemPostingGroupId) lives on itemCost and is merged in
// separately by readItemAttributes. `active` is intentionally excluded — a CO
// draft is created inactive until release, so it always differs (not a real edit).
const ITEM_ATTRIBUTE_COLUMNS =
  "name, description, unitOfMeasureCode, itemTrackingType, defaultMethodType, replenishmentSystem, sourcingType, thumbnailPath, mpn";

// Read one make method's materials + operations + per-operation children (real
// method tables — the v2 substrate). Empty for a null makeMethodId (e.g. a Buy
// item with no method, or before a draft exists).
async function readMethodRows(
  client: SupabaseClient<Database>,
  makeMethodId: string | null,
  companyId: string
): Promise<{
  materials: Row[];
  operations: Row[];
  children: ChildrenByOperationId;
  error: { message: string } | null;
}> {
  const empty = { materials: [], operations: [], children: {}, error: null };
  if (!makeMethodId) return empty;

  const [materials, operations] = await Promise.all([
    client
      .from("methodMaterial")
      .select("*")
      .eq("makeMethodId", makeMethodId)
      .eq("companyId", companyId)
      .order("order", { ascending: true }),
    client
      .from("methodOperation")
      .select("*")
      .eq("makeMethodId", makeMethodId)
      .eq("companyId", companyId)
      .order("order", { ascending: true })
  ]);
  if (materials.error) return { ...empty, error: materials.error };
  if (operations.error) return { ...empty, error: operations.error };

  const ops = (operations.data ?? []) as Row[];
  const children: ChildrenByOperationId = {};
  const opIds = ops
    .map((o) => o.id)
    .filter((id): id is string => typeof id === "string");

  if (opIds.length > 0) {
    const [steps, parameters, tools] = await Promise.all([
      client
        .from("methodOperationStep")
        .select("*")
        .in("operationId", opIds)
        .eq("companyId", companyId),
      client
        .from("methodOperationParameter")
        .select("*")
        .in("operationId", opIds)
        .eq("companyId", companyId),
      client
        .from("methodOperationTool")
        .select("*")
        .in("operationId", opIds)
        .eq("companyId", companyId)
    ]);
    if (steps.error) return { ...empty, error: steps.error };
    if (parameters.error) return { ...empty, error: parameters.error };
    if (tools.error) return { ...empty, error: tools.error };

    for (const id of opIds)
      children[id] = { steps: [], parameters: [], tools: [] };
    for (const r of (steps.data ?? []) as Row[]) {
      const op = r.operationId;
      if (typeof op === "string") children[op]?.steps.push(r);
    }
    for (const r of (parameters.data ?? []) as Row[]) {
      const op = r.operationId;
      if (typeof op === "string") children[op]?.parameters.push(r);
    }
    for (const r of (tools.data ?? []) as Row[]) {
      const op = r.operationId;
      if (typeof op === "string") children[op]?.tools.push(r);
    }
  }

  return {
    materials: (materials.data ?? []) as Row[],
    operations: ops,
    children,
    error: null
  };
}

// The v2 draft method is created by copying the base method, so it initially
// mirrors the base 1:1 with NO back-pointer ids. We reconstruct the source
// pointers the pure engine expects by matching each target row to a base row on
// a natural key (materials → component itemId, operations → order, children →
// name/key/toolId), first-unmatched-wins. An unmatched target row is an add; an
// unmatched base row is a remove.
function correlate(
  base: Row[],
  target: Row[],
  keyField: string,
  sourceKey: string
): void {
  const usedBaseIds = new Set<string>();
  for (const t of target) {
    const key = t[keyField];
    const match = base.find(
      (b) =>
        b[keyField] === key &&
        typeof b.id === "string" &&
        !usedBaseIds.has(b.id)
    );
    if (match && typeof match.id === "string") {
      usedBaseIds.add(match.id);
      t[sourceKey] = match.id;
    } else {
      t[sourceKey] = null;
    }
  }
}

async function readItemAttributes(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<Row | null> {
  const [item, cost] = await Promise.all([
    client
      .from("item")
      .select(ITEM_ATTRIBUTE_COLUMNS)
      .eq("id", itemId)
      .eq("companyId", companyId)
      .maybeSingle(),
    // The item group lives on itemCost, not item — merge it in so it diffs too.
    client
      .from("itemCost")
      .select("itemPostingGroupId")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (!item.data) return null;
  return {
    ...(item.data as Row),
    itemPostingGroupId: cost.data?.itemPostingGroupId ?? null
  };
}

// A Revision/New Part draft item starts with no supplier parts (the source's
// aren't copied); the ones the user sets up on the CO line are surfaced as `added`
// entries. Mirrors getSupplierParts (items.service) — active rows for the item.
async function readDraftSupplierParts(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<{
  data: MethodDiffEntry<Row>[];
  error: { message: string } | null;
}> {
  const res = await client
    .from("supplierPart")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("active", true);
  if (res.error) return { data: [], error: res.error };
  return {
    data: (res.data ?? []).map((row) => ({
      status: "added" as const,
      before: null,
      after: row as Row
    })),
    error: null
  };
}

// Resolve item-group ids → their names for readable diff display.
async function readPostingGroupNames(
  client: SupabaseClient<Database>,
  ids: string[],
  companyId: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)].filter((id) => id.length > 0);
  if (unique.length === 0) return map;
  const groups = await client
    .from("itemPostingGroup")
    .select("id, name")
    .in("id", unique)
    .eq("companyId", companyId);
  for (const g of groups.data ?? []) {
    if (g.id && g.name) map.set(g.id, g.name);
  }
  return map;
}

// Resolve component item UUIDs → human-readable ids (e.g. `P000123.A`). The diff
// viewer labels each BOM line by its component; a `methodMaterial` row carries only
// the item UUID, and the client `useItems` store can miss a just-minted/placeholder
// component. Resolving here (server-side, guaranteed present) makes the label
// store-independent. Flat select scoped by companyId.
async function readItemReadableIds(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(itemIds)].filter((id) => id.length > 0);
  if (unique.length === 0) return map;
  const items = await client
    .from("item")
    .select("id, readableIdWithRevision")
    .in("id", unique)
    .eq("companyId", companyId);
  for (const row of items.data ?? []) {
    if (row.id && row.readableIdWithRevision)
      map.set(row.id, row.readableIdWithRevision);
  }
  return map;
}

// Stamp the resolved readable id onto each material diff row (before + after) under
// `itemReadableId`, so the read-only viewer can label the line without a store
// lookup. Applied AFTER diffMethod so it never counts as a business-field change.
function stampMaterialReadableIds(
  materials: MethodDiffEntry<Row>[],
  readableIds: Map<string, string>
): void {
  for (const entry of materials) {
    for (const row of [entry.before, entry.after]) {
      const itemId = (row as { itemId?: string } | null)?.itemId;
      if (row && typeof itemId === "string") {
        const readable = readableIds.get(itemId);
        if (readable) (row as Row).itemReadableId = readable;
      }
    }
  }
}

// A methodOperationTool row references a Tool item by `toolId` (a UUID). Stamp the
// resolved readable id onto each tool child row (before + after) under
// `toolReadableId` so the viewer labels the tool by its readable id, not the UUID.
function stampToolReadableIds(
  operations: OperationDiffEntry[],
  readableIds: Map<string, string>
): void {
  for (const op of operations) {
    for (const entry of op.children?.tools ?? []) {
      for (const row of [entry.before, entry.after]) {
        const toolId = (row as { toolId?: string } | null)?.toolId;
        if (row && typeof toolId === "string") {
          const readable = readableIds.get(toolId);
          if (readable) (row as Row).toolReadableId = readable;
        }
      }
    }
  }
}

// Operation rows reference a process / work center / procedure / supplier process
// by UUID. Resolve those to human names and rewrite them IN PLACE — both the
// changedFields (old→new) and the before/after rows (add/remove property lists) —
// so the diff and merge UIs read "CNC Milling", not a raw id. Display-only, applied
// AFTER diffMethod (so it never counts as a business-field change); the release
// apply re-reads rows by id, so mutating these display rows is safe.
const OPERATION_REF_FIELDS = [
  "processId",
  "workCenterId",
  "procedureId",
  "operationSupplierProcessId",
  "assemblyInstructionId",
  "inspectionDocumentId"
] as const;
const OPERATION_REF_FIELD_SET = new Set<string>(OPERATION_REF_FIELDS);

async function stampOperationRefNames(
  client: SupabaseClient<Database>,
  operations: OperationDiffEntry[],
  companyId: string
): Promise<void> {
  // Gather every referenced id per field, from both the rows and changedFields.
  const collected: Record<string, Set<string>> = {
    processId: new Set(),
    workCenterId: new Set(),
    procedureId: new Set(),
    operationSupplierProcessId: new Set(),
    assemblyInstructionId: new Set(),
    inspectionDocumentId: new Set()
  };
  const addFrom = (row: Row | null) => {
    if (!row) return;
    for (const f of OPERATION_REF_FIELDS) {
      const v = row[f];
      if (typeof v === "string" && v) collected[f].add(v);
    }
  };
  for (const op of operations) {
    addFrom(op.before as Row | null);
    addFrom(op.after as Row | null);
    for (const [f, cf] of Object.entries(op.changedFields ?? {})) {
      if (!OPERATION_REF_FIELD_SET.has(f)) continue;
      if (typeof cf.before === "string" && cf.before)
        collected[f].add(cf.before);
      if (typeof cf.after === "string" && cf.after) collected[f].add(cf.after);
    }
  }

  const names = new Map<string, string>(); // id → display name (any ref type)
  const load = async (
    table: "process" | "workCenter" | "procedure" | "assemblyInstruction",
    ids: Set<string>
  ) => {
    const unique = [...ids];
    if (unique.length === 0) return;
    const rows = await client
      .from(table)
      .select("id, name")
      .in("id", unique)
      .eq("companyId", companyId);
    for (const r of rows.data ?? []) {
      if (r.id && r.name) names.set(r.id, r.name);
    }
  };

  // A supplier process has no name of its own — resolve it to its process name
  // (its underlying process ids join the process lookup below).
  const supplierProcessIds = [...collected.operationSupplierProcessId];
  const supplierProcessToProcess = new Map<string, string>();
  if (supplierProcessIds.length > 0) {
    const sp = await client
      .from("supplierProcess")
      .select("id, processId")
      .in("id", supplierProcessIds)
      .eq("companyId", companyId);
    for (const r of sp.data ?? []) {
      if (r.id && r.processId) {
        supplierProcessToProcess.set(r.id, r.processId);
        collected.processId.add(r.processId);
      }
    }
  }

  await Promise.all([
    load("process", collected.processId),
    load("workCenter", collected.workCenterId),
    load("procedure", collected.procedureId),
    load("assemblyInstruction", collected.assemblyInstructionId)
  ]);

  // Inspection documents have no "name" column — label them by drawing/file name.
  const inspectionDocumentIds = [...collected.inspectionDocumentId];
  if (inspectionDocumentIds.length > 0) {
    const docs = await client
      .from("inspectionDocument")
      .select("id, drawingNumber, fileName")
      .in("id", inspectionDocumentIds)
      .eq("companyId", companyId);
    for (const d of docs.data ?? []) {
      if (d.id) names.set(d.id, d.drawingNumber || d.fileName || d.id);
    }
  }

  for (const [spId, processId] of supplierProcessToProcess) {
    const name = names.get(processId);
    if (name) names.set(spId, name);
  }

  const rewrite = (row: Row | null) => {
    if (!row) return;
    for (const f of OPERATION_REF_FIELDS) {
      const v = row[f];
      if (typeof v === "string" && names.has(v)) row[f] = names.get(v);
    }
  };
  for (const op of operations) {
    rewrite(op.before as Row | null);
    rewrite(op.after as Row | null);
    for (const [f, cf] of Object.entries(op.changedFields ?? {})) {
      if (!OPERATION_REF_FIELD_SET.has(f)) continue;
      if (typeof cf.before === "string" && names.has(cf.before))
        cf.before = names.get(cf.before);
      if (typeof cf.after === "string" && names.has(cf.after))
        cf.after = names.get(cf.after);
    }
  }
}

// For every affected item: read the base (source Active) method as `base` and the
// CO-owned Draft method as `target` (both REAL method tables), correlate by
// natural keys, run the pure `diffMethod`, and collect. Also returns the manual
// supersession declarations. Flat selects scoped by companyId (no embeds).
export async function getChangeNoticeDiff(
  client: SupabaseClient<Database>,
  changeNoticeId: string,
  companyId: string
): Promise<{ data: ChangeNoticeDiff; error: { message: string } | null }> {
  const affected = await getChangeNoticeAffectedItems(
    client,
    changeNoticeId,
    companyId
  );
  if (affected.error) return { data: { items: [] }, error: affected.error };

  const items: ChangeNoticeItemDiff[] = [];

  for (const affectedItem of affected.data) {
    const base = await readMethodRows(
      client,
      affectedItem.baseMakeMethodId,
      companyId
    );
    if (base.error) return { data: { items: [] }, error: base.error };
    const target = await readMethodRows(
      client,
      affectedItem.draftMakeMethodId,
      companyId
    );
    if (target.error) return { data: { items: [] }, error: target.error };

    // Reconstruct source pointers by natural key.
    correlate(base.materials, target.materials, "itemId", MATERIAL_SOURCE_KEY);
    correlate(
      base.operations,
      target.operations,
      "order",
      OPERATION_SOURCE_KEY
    );
    for (const top of target.operations) {
      const baseOpId = top[OPERATION_SOURCE_KEY];
      const topId = top.id;
      if (typeof baseOpId !== "string" || typeof topId !== "string") continue;
      const bKids = base.children[baseOpId];
      const tKids = target.children[topId];
      if (!bKids || !tKids) continue;
      correlate(bKids.steps, tKids.steps, "name", CHILD_SOURCE_KEY);
      correlate(bKids.parameters, tKids.parameters, "key", CHILD_SOURCE_KEY);
      correlate(bKids.tools, tKids.tools, "toolId", CHILD_SOURCE_KEY);
    }

    // A New Part is net-new: no predecessor item, so `newItemId === itemId`.
    // Its whole attribute set + supplier parts are additions, not old→new edits.
    const isNewPart = affectedItem.changeType === "New Part";

    // Attribute diff: base = source item columns; target = the draft item's
    // columns. For a Version the draft is on the same item, so there is no
    // attribute change (Q2) and both sides read the same row. For a New Part
    // there is no predecessor, so we pass a null base to surface every attribute
    // as an addition (see diffAttributes).
    const draftItemId = affectedItem.newItemId ?? affectedItem.itemId;
    const baseAttributes = await readItemAttributes(
      client,
      affectedItem.itemId,
      companyId
    );
    const targetAttributes =
      draftItemId === affectedItem.itemId
        ? baseAttributes
        : await readItemAttributes(client, draftItemId, companyId);

    // Supplier parts on the draft item (Revision/Replacement Part/New Part; a
    // Version shares the live item's suppliers, which are not a CO change).
    // Surfaced as additions. A New Part's draft item IS its own item
    // (draftItemId === itemId), so gate on the change type too.
    let supplierParts: MethodDiffEntry<Row>[] = [];
    if (draftItemId !== affectedItem.itemId || isNewPart) {
      const sp = await readDraftSupplierParts(client, draftItemId, companyId);
      if (sp.error) return { data: { items: [] }, error: sp.error };
      supplierParts = sp.data;
    }

    const diff = diffMethod({
      baseMaterials: base.materials,
      targetMaterials: target.materials,
      baseOperations: base.operations,
      targetOperations: target.operations,
      baseAttributes: isNewPart ? null : baseAttributes,
      targetAttributes,
      baseOperationChildren: base.children,
      targetOperationChildren: target.children
    });

    // Label BOM lines by their component's readable id and BOP tools by the tool
    // item's readable id (both reference item UUIDs) — store-independent. One
    // batch resolve over every referenced item id.
    const componentIds = [...base.materials, ...target.materials]
      .map((m) => m.itemId)
      .filter((id): id is string => typeof id === "string");
    const toolIds = diff.operations.flatMap((op) =>
      (op.children?.tools ?? [])
        .flatMap((tool) => [tool.before, tool.after])
        .map((row) => (row as { toolId?: string } | null)?.toolId)
        .filter((id): id is string => typeof id === "string")
    );
    const readableIds = await readItemReadableIds(
      client,
      [...componentIds, ...toolIds],
      companyId
    );
    stampMaterialReadableIds(diff.materials, readableIds);
    stampToolReadableIds(diff.operations, readableIds);
    await stampOperationRefNames(client, diff.operations, companyId);

    // Resolve the item-group id → name so the attribute diff reads "Group A →
    // Group B" instead of opaque ids. A modified attribute carries the id in
    // `changedFields`; an added/removed one (a New Part) carries it on the raw
    // before/after row that the full-property list renders directly.
    const groupIds = diff.attributes.flatMap((a) => {
      const ids: string[] = [];
      const cf = a.changedFields?.itemPostingGroupId;
      if (cf) {
        if (typeof cf.before === "string") ids.push(cf.before);
        if (typeof cf.after === "string") ids.push(cf.after);
      }
      for (const row of [a.before, a.after]) {
        const gid = (row as { itemPostingGroupId?: unknown } | null)
          ?.itemPostingGroupId;
        if (typeof gid === "string") ids.push(gid);
      }
      return ids;
    });
    if (groupIds.length > 0) {
      const names = await readPostingGroupNames(client, groupIds, companyId);
      for (const a of diff.attributes) {
        const cf = a.changedFields?.itemPostingGroupId;
        if (cf) {
          if (typeof cf.before === "string")
            cf.before = names.get(cf.before) ?? cf.before;
          if (typeof cf.after === "string")
            cf.after = names.get(cf.after) ?? cf.after;
        }
        for (const row of [a.before, a.after]) {
          const r = row as { itemPostingGroupId?: unknown } | null;
          if (r && typeof r.itemPostingGroupId === "string") {
            r.itemPostingGroupId =
              names.get(r.itemPostingGroupId) ?? r.itemPostingGroupId;
          }
        }
      }
    }

    items.push({
      affectedItemId: affectedItem.id,
      itemId: affectedItem.itemId,
      materials: diff.materials,
      operations: diff.operations,
      attributes: diff.attributes,
      supplierParts
    });
  }

  return { data: { items }, error: null };
}

/**
 * Create a presigned upload URL for an item (part/material/tool/consumable/service)
 * document. First step of the two-step upload flow: PUT the file bytes to the
 * returned `signedUrl`, then call `documents_insertUploadedDocument` with the
 * returned `path`, the item's type as `sourceDocument`, and
 * `sourceDocumentId: itemId`.
 */
export async function createItemDocumentUploadUrl(
  client: SupabaseClient<Database>,
  args: { companyId: string; itemId: string; name: string }
) {
  return createDocumentUploadUrl(client, {
    companyId: args.companyId,
    folder: "parts",
    entityId: args.itemId,
    name: args.name
  });
}

// =============================================================================
// Change Notice Operational Impact — Slice 1 contracts and candidate reads.
//
// The normalization/comparison and candidate-read portion below is intentionally
// read-only. Slice 2A's first-assessment writer is kept in a separate section at
// the end of this file; no candidate read is mutation authority.
// =============================================================================

type ImpactRecord = Record<string, unknown>;

type ImpactDateValue =
  | { ok: true; value: string | null }
  | { ok: false; reason: string };

type ImpactNumberValue =
  | { ok: true; value: number }
  | { ok: false; reason: string };

const IMPACT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IMPACT_KEY_SEPARATOR = "\u001f";
const IMPACT_PAGE_SIZE = 500;
const IMPACT_ID_BATCH_SIZE = 50;
const IMPACT_WORKSPACE_MAX_PAGES = 100;
const IMPACT_WORKSPACE_MAX_ROWS_PER_STREAM =
  IMPACT_PAGE_SIZE * IMPACT_WORKSPACE_MAX_PAGES;

const PO_LINE_TYPES = [
  "Comment",
  "G/L Account",
  "Fixed Asset",
  "Part",
  "Material",
  "Tool",
  "Service",
  "Consumable",
  "Fixture"
] as const;

const PO_LINE_STATUS_TYPES = [
  ...purchaseOrderLineImpactCurrentStatuses,
  ...purchaseOrderLineImpactHistoricalStatuses
] as const;

const PO_LINE_ASSESSMENT_TYPES = PO_LINE_TYPES.filter(
  (lineType) =>
    !(purchaseOrderLineImpactNonAssessmentTypes as readonly string[]).includes(
      lineType
    )
);

const JOB_STATUS_TYPES = [
  ...jobImpactActiveStatuses,
  ...jobImpactHistoricalStatuses
] as const;

const METHOD_TYPES = [
  "Purchase to Order",
  "Pull from Inventory",
  "Make to Order"
] as const;

const SNAPSHOT_KEYS = {
  purchaseOrderLine: [
    "schema",
    "purchaseOrderLineId",
    "purchaseOrderId",
    "supplierId",
    "itemId",
    "itemRevision",
    "purchaseOrderLineType",
    "purchaseOrderStatus",
    "receivedComplete",
    "orderedQuantity",
    "receivedQuantity",
    "remainingQuantity",
    "purchaseUnitOfMeasureCode",
    "inventoryUnitOfMeasureCode",
    "conversionFactor",
    "requiredDate",
    "promisedDate",
    "eligibilityBasis"
  ],
  job: [
    "schema",
    "jobId",
    "itemId",
    "itemRevision",
    "status",
    "plannedQuantity",
    "completedQuantity",
    "remainingQuantity",
    "quantityShipped",
    "quantityReceivedToInventory",
    "dueDate",
    "effectiveMethodId",
    "effectiveMethodVersion",
    "unitOfMeasureCode",
    "eligibilityBasis"
  ],
  jobMaterial: [
    "schema",
    "jobMaterialId",
    "jobId",
    "itemId",
    "itemRevision",
    "jobStatus",
    "requiredQuantity",
    "issuedQuantity",
    "remainingQuantity",
    "unitOfMeasureCode",
    "methodType",
    "jobOperationId",
    "requiresTracking",
    "eligibilityBasis"
  ]
} as const;

function isImpactRecord(value: unknown): value is ImpactRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function impactRecordRows(value: unknown): ImpactRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isImpactRecord);
}

function impactValue(
  input: ImpactRecord,
  ...keys: string[]
): unknown | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  }
  return undefined;
}

function impactRelatedName(value: unknown): string | null {
  const relation = Array.isArray(value)
    ? value.find(isImpactRecord)
    : isImpactRecord(value)
      ? value
      : null;
  return relation ? impactNullableString(relation.name) : null;
}

function impactFirstDefined(
  input: ImpactRecord,
  ...keys: string[]
): unknown | undefined {
  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(input, key) &&
      input[key] !== undefined
    ) {
      return input[key];
    }
  }
  return undefined;
}

function impactRequiredString(
  value: unknown,
  field: string
): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, reason: `${field} is required` };
  }
  return { ok: true, value };
}

function impactNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function impactPersistedRequiredString(
  value: unknown,
  field: string
): { ok: true; value: string } | { ok: false; reason: string } {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim()
  ) {
    return { ok: false, reason: `${field} is required` };
  }
  return { ok: true, value };
}

type ImpactCanonicalNullableString =
  | { ok: true; value: string | null }
  | { ok: false; reason: string };

function impactCanonicalNullableString(
  value: unknown,
  field: string
): ImpactCanonicalNullableString {
  if (value === null) return { ok: true, value: null };
  if (value === undefined) {
    return {
      ok: false,
      reason: `${field} must be explicitly null or a string`
    };
  }
  if (typeof value !== "string") {
    return { ok: false, reason: `${field} must be a string or null` };
  }
  if (value.length === 0) {
    return { ok: false, reason: `${field} must not be empty` };
  }
  return { ok: true, value };
}

function impactDate(value: unknown, field: string): ImpactDateValue {
  if (value === null) return { ok: true, value: null };
  if (value === undefined) {
    return {
      ok: false,
      reason: `${field} must be explicitly null or a canonical date`
    };
  }
  if (typeof value !== "string" || !IMPACT_DATE_PATTERN.test(value)) {
    return {
      ok: false,
      reason: `${field} must be a canonical YYYY-MM-DD date`
    };
  }
  try {
    parseDate(value);
  } catch {
    return { ok: false, reason: `${field} is not a valid calendar date` };
  }
  return { ok: true, value };
}

function impactNumber(
  value: unknown,
  field: string
): { ok: true; value: number } | { ok: false; reason: string };
function impactNumber(
  value: unknown,
  field: string,
  nullable: true
): { ok: true; value: number | null } | { ok: false; reason: string };
function impactNumber(
  value: unknown,
  field: string,
  nullable = false
): ImpactNumberValue | { ok: true; value: number | null } {
  if (value === null || value === undefined || value === "") {
    return nullable
      ? { ok: true, value: null }
      : { ok: false, reason: `${field} is required` };
  }
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return { ok: false, reason: `${field} must be a finite number` };
  }
  return { ok: true, value: round(numeric) };
}

function impactRawNumber(
  value: unknown,
  field: string
): { ok: true; value: number } | { ok: false; reason: string } {
  if (value === null || value === undefined || value === "") {
    return { ok: false, reason: `${field} is required` };
  }
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numeric)
    ? { ok: true, value: numeric }
    : { ok: false, reason: `${field} must be a finite number` };
}

function impactQuantity(value: unknown, field: string): ImpactNumberValue {
  const numeric = impactRawNumber(value, field);
  if (!numeric.ok) return numeric;
  if (numeric.value < 0) {
    return { ok: false, reason: `${field} must be non-negative` };
  }
  return { ok: true, value: round(numeric.value) };
}

function impactNullableQuantity(
  value: unknown,
  field: string
): { ok: true; value: number | null } | { ok: false; reason: string } {
  if (value === null) return { ok: true, value: null };
  if (value === undefined || value === "") {
    return {
      ok: false,
      reason: `${field} must be explicitly null or a number`
    };
  }
  return impactQuantity(value, field);
}

function impactFactor(value: unknown): ImpactNumberValue {
  // Carbon's purchasing paths consistently treat a null conversion factor as
  // the database default of one. The normalized snapshot stores that effective
  // factor, rather than preserving a storage-level null that means the same
  // thing.
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: 1 };
  }
  const numeric = impactRawNumber(value, "conversionFactor");
  if (!numeric.ok || numeric.value <= 0) {
    return {
      ok: false,
      reason: "conversionFactor must be greater than zero"
    };
  }
  const normalized = round(numeric.value);
  if (normalized <= 0) {
    return {
      ok: false,
      reason:
        "conversionFactor must remain greater than zero at Carbon precision"
    };
  }
  return { ok: true, value: normalized };
}

function impactBoolean(
  value: unknown,
  field: string
): { ok: true; value: boolean } | { ok: false; reason: string } {
  if (typeof value !== "boolean") {
    return { ok: false, reason: `${field} is required` };
  }
  return { ok: true, value };
}

function impactIn<T extends string>(
  value: unknown,
  values: readonly T[]
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function impactUnavailable(
  reason: string
): ChangeNoticeImpactSnapshotNormalization {
  return { sourceAvailability: "Unavailable", snapshot: null, reason };
}

function impactDateOrUnavailable(
  value: unknown,
  field: string
):
  | { ok: true; value: string | null }
  | { ok: false; result: ChangeNoticeImpactSnapshotNormalization } {
  const normalized = impactDate(value, field);
  return normalized.ok
    ? normalized
    : { ok: false, result: impactUnavailable(normalized.reason) };
}

/** Normalize one PO line into the exact PO_LINE_SNAPSHOT_V1 key set. */
export function normalizePurchaseOrderLineImpactSnapshot(
  source: ChangeNoticeImpactPurchaseOrderLineSnapshotInput
): ChangeNoticeImpactSnapshotNormalization {
  const input = source as ImpactRecord;
  const lineId = impactRequiredString(
    impactValue(input, "purchaseOrderLineId", "id"),
    "purchaseOrderLineId"
  );
  const purchaseOrderId = impactRequiredString(
    impactValue(input, "purchaseOrderId"),
    "purchaseOrderId"
  );
  const supplierId = impactRequiredString(
    impactValue(input, "supplierId"),
    "supplierId"
  );
  const itemId = impactRequiredString(impactValue(input, "itemId"), "itemId");
  if (!lineId.ok || !purchaseOrderId.ok || !supplierId.ok || !itemId.ok) {
    return impactUnavailable(
      [lineId, purchaseOrderId, supplierId, itemId]
        .filter((value): value is { ok: false; reason: string } => !value.ok)
        .map((value) => value.reason)
        .join("; ")
    );
  }

  const lineType = impactValue(input, "purchaseOrderLineType");
  if (!impactIn(lineType, PO_LINE_TYPES)) {
    return impactUnavailable("purchaseOrderLineType is unknown");
  }
  const status = impactValue(input, "purchaseOrderStatus");
  if (!impactIn(status, PO_LINE_STATUS_TYPES)) {
    return impactUnavailable("purchaseOrderStatus is unknown or unclassified");
  }
  const receivedComplete = impactBoolean(
    impactValue(input, "receivedComplete"),
    "receivedComplete"
  );
  if (!receivedComplete.ok) return impactUnavailable(receivedComplete.reason);

  const deliveryRowPresent = impactValue(input, "deliveryRowPresent");
  if (deliveryRowPresent === false) {
    return impactUnavailable(
      "Required purchase-order delivery facts are unavailable."
    );
  }
  if (
    deliveryRowPresent !== undefined &&
    typeof deliveryRowPresent !== "boolean"
  ) {
    return impactUnavailable("deliveryRowPresent must be a boolean");
  }

  const factor = impactFactor(impactValue(input, "conversionFactor"));
  if (!factor.ok) return impactUnavailable(factor.reason);

  const ordered = impactQuantity(
    impactValue(input, "purchaseQuantity"),
    "purchaseQuantity"
  );
  const received = impactQuantity(
    impactValue(input, "quantityReceived"),
    "quantityReceived"
  );
  const remaining = impactQuantity(
    impactValue(input, "quantityToReceive", "remainingQuantity"),
    "quantityToReceive"
  );
  if (!ordered.ok || !received.ok || !remaining.ok) {
    return impactUnavailable(
      [ordered, received, remaining]
        .filter((value): value is { ok: false; reason: string } => !value.ok)
        .map((value) => value.reason)
        .join("; ")
    );
  }

  const requiredDate = impactDateOrUnavailable(
    impactValue(input, "requiredDate"),
    "requiredDate"
  );
  if (!requiredDate.ok) return requiredDate.result;
  const linePromisedDate = impactDateOrUnavailable(
    impactValue(input, "promisedDate", "linePromisedDate"),
    "promisedDate"
  );
  if (!linePromisedDate.ok) return linePromisedDate.result;
  const deliveryPromisedDate = impactDateOrUnavailable(
    impactValue(input, "deliveryReceiptPromisedDate"),
    "deliveryReceiptPromisedDate"
  );
  if (!deliveryPromisedDate.ok) return deliveryPromisedDate.result;

  const itemRevision = impactCanonicalNullableString(
    impactValue(input, "itemRevision", "revision"),
    "itemRevision"
  );
  const purchaseUnitOfMeasureCode = impactCanonicalNullableString(
    impactValue(input, "purchaseUnitOfMeasureCode"),
    "purchaseUnitOfMeasureCode"
  );
  const inventoryUnitOfMeasureCode = impactCanonicalNullableString(
    impactValue(input, "inventoryUnitOfMeasureCode"),
    "inventoryUnitOfMeasureCode"
  );
  if (
    !itemRevision.ok ||
    !purchaseUnitOfMeasureCode.ok ||
    !inventoryUnitOfMeasureCode.ok
  ) {
    return impactUnavailable(
      [itemRevision, purchaseUnitOfMeasureCode, inventoryUnitOfMeasureCode]
        .filter((value): value is { ok: false; reason: string } => !value.ok)
        .map((value) => value.reason)
        .join("; ")
    );
  }
  const normalizedFactor = factor.value;
  const promisedDate =
    linePromisedDate.value ?? deliveryPromisedDate.value ?? null;

  return {
    sourceAvailability: "Present",
    snapshot: {
      schema: PO_LINE_SNAPSHOT_V1,
      purchaseOrderLineId: lineId.value,
      purchaseOrderId: purchaseOrderId.value,
      supplierId: supplierId.value,
      itemId: itemId.value,
      itemRevision: itemRevision.value,
      purchaseOrderLineType:
        lineType as PurchaseOrderLineImpactSnapshot["purchaseOrderLineType"],
      purchaseOrderStatus:
        status as PurchaseOrderLineImpactSnapshot["purchaseOrderStatus"],
      receivedComplete: receivedComplete.value,
      orderedQuantity: round(ordered.value),
      receivedQuantity: round(received.value),
      remainingQuantity: round(remaining.value),
      purchaseUnitOfMeasureCode: purchaseUnitOfMeasureCode.value,
      inventoryUnitOfMeasureCode: inventoryUnitOfMeasureCode.value,
      conversionFactor: normalizedFactor,
      requiredDate: requiredDate.value,
      promisedDate,
      eligibilityBasis: OPEN_PURCHASING_COMMITMENT
    }
  };
}

/** Normalize one producing Job into the exact JOB_SNAPSHOT_V1 key set. */
export function normalizeJobImpactSnapshot(
  source: ChangeNoticeImpactJobSnapshotInput
): ChangeNoticeImpactSnapshotNormalization {
  const input = source as ImpactRecord;
  const jobId = impactRequiredString(
    impactValue(input, "jobId", "id"),
    "jobId"
  );
  const itemId = impactRequiredString(impactValue(input, "itemId"), "itemId");
  const methodId = impactRequiredString(
    impactValue(input, "effectiveMethodId"),
    "effectiveMethodId"
  );
  const unitOfMeasureCode = impactRequiredString(
    impactValue(input, "unitOfMeasureCode"),
    "unitOfMeasureCode"
  );
  if (!jobId.ok || !itemId.ok || !methodId.ok || !unitOfMeasureCode.ok) {
    return impactUnavailable(
      [jobId, itemId, methodId, unitOfMeasureCode]
        .filter((value): value is { ok: false; reason: string } => !value.ok)
        .map((value) => value.reason)
        .join("; ")
    );
  }

  const status = impactValue(input, "status");
  if (!impactIn(status, JOB_STATUS_TYPES)) {
    return impactUnavailable("job.status is unknown or unclassified");
  }
  // Carbon's canonical planned quantity is job.quantity. Keep the explicit
  // normalized alias first, then the live source field.
  const planned = impactQuantity(
    impactFirstDefined(input, "plannedQuantity", "quantity"),
    "plannedQuantity"
  );
  const completed = impactQuantity(
    impactValue(input, "completedQuantity", "quantityComplete"),
    "completedQuantity"
  );
  const shipped = impactQuantity(
    impactValue(input, "quantityShipped"),
    "quantityShipped"
  );
  const received = impactQuantity(
    impactValue(input, "quantityReceivedToInventory"),
    "quantityReceivedToInventory"
  );
  const version = impactNumber(
    impactValue(input, "effectiveMethodVersion"),
    "effectiveMethodVersion"
  );
  if (
    !planned.ok ||
    !completed.ok ||
    !shipped.ok ||
    !received.ok ||
    !version.ok
  ) {
    return impactUnavailable(
      [planned, completed, shipped, received, version]
        .filter((value): value is { ok: false; reason: string } => !value.ok)
        .map((value) => value.reason)
        .join("; ")
    );
  }

  const dueDate = impactDateOrUnavailable(
    impactValue(input, "dueDate"),
    "dueDate"
  );
  if (!dueDate.ok) return dueDate.result;
  const remaining = {
    ok: true as const,
    value: round(Math.max(planned.value - completed.value, 0))
  };
  const itemRevision = impactCanonicalNullableString(
    impactValue(input, "itemRevision", "revision"),
    "itemRevision"
  );
  if (!itemRevision.ok) return impactUnavailable(itemRevision.reason);

  return {
    sourceAvailability: "Present",
    snapshot: {
      schema: JOB_SNAPSHOT_V1,
      jobId: jobId.value,
      itemId: itemId.value,
      itemRevision: itemRevision.value,
      status: status as JobImpactSnapshot["status"],
      plannedQuantity: planned.value,
      completedQuantity: completed.value,
      remainingQuantity: remaining.value,
      quantityShipped: shipped.value,
      quantityReceivedToInventory: received.value,
      dueDate: dueDate.value,
      effectiveMethodId: methodId.value,
      effectiveMethodVersion: version.value,
      unitOfMeasureCode: unitOfMeasureCode.value,
      eligibilityBasis: ACTIVE_PRODUCING_JOB
    }
  };
}

/** Normalize one Job Material into the exact JOB_MATERIAL_SNAPSHOT_V1 key set. */
export function normalizeJobMaterialImpactSnapshot(
  source: ChangeNoticeImpactJobMaterialSnapshotInput
): ChangeNoticeImpactSnapshotNormalization {
  const input = source as ImpactRecord;
  const materialId = impactRequiredString(
    impactValue(input, "jobMaterialId", "id"),
    "jobMaterialId"
  );
  const jobId = impactRequiredString(impactValue(input, "jobId"), "jobId");
  const itemId = impactRequiredString(impactValue(input, "itemId"), "itemId");
  if (!materialId.ok || !jobId.ok || !itemId.ok) {
    return impactUnavailable(
      [materialId, jobId, itemId]
        .filter((value): value is { ok: false; reason: string } => !value.ok)
        .map((value) => value.reason)
        .join("; ")
    );
  }

  const status = impactValue(input, "jobStatus");
  if (!impactIn(status, JOB_STATUS_TYPES)) {
    return impactUnavailable("parent job.status is unknown or unclassified");
  }
  const required = impactQuantity(
    impactValue(input, "requiredQuantity", "estimatedQuantity"),
    "requiredQuantity"
  );
  const issued = impactNullableQuantity(
    impactValue(input, "issuedQuantity", "quantityIssued"),
    "issuedQuantity"
  );
  const remaining = impactQuantity(
    impactValue(input, "remainingQuantity", "quantityToIssue"),
    "remainingQuantity"
  );
  if (!required.ok || !issued.ok || !remaining.ok) {
    return impactUnavailable(
      [required, issued, remaining]
        .filter((value): value is { ok: false; reason: string } => !value.ok)
        .map((value) => value.reason)
        .join("; ")
    );
  }

  const method = impactValue(input, "methodType");
  if (!impactIn(method, METHOD_TYPES)) {
    return impactUnavailable("methodType is unknown or unclassified");
  }

  const trackingRecord = impactValue(input, "requiresTracking");
  let batch: unknown;
  let serial: unknown;
  if (isImpactRecord(trackingRecord)) {
    batch = trackingRecord.batch;
    serial = trackingRecord.serial;
  } else {
    batch = impactValue(input, "requiresBatchTracking");
    serial = impactValue(input, "requiresSerialTracking");
  }
  const requiresBatch = impactBoolean(batch, "requiresBatchTracking");
  const requiresSerial = impactBoolean(serial, "requiresSerialTracking");
  if (!requiresBatch.ok || !requiresSerial.ok) {
    return impactUnavailable(
      [requiresBatch, requiresSerial]
        .filter((value): value is { ok: false; reason: string } => !value.ok)
        .map((value) => value.reason)
        .join("; ")
    );
  }
  const itemRevision = impactCanonicalNullableString(
    impactValue(input, "itemRevision", "revision"),
    "itemRevision"
  );
  const unitOfMeasureCode = impactCanonicalNullableString(
    impactValue(input, "unitOfMeasureCode"),
    "unitOfMeasureCode"
  );
  const jobOperationId = impactCanonicalNullableString(
    impactValue(input, "jobOperationId"),
    "jobOperationId"
  );
  if (!itemRevision.ok || !unitOfMeasureCode.ok || !jobOperationId.ok) {
    return impactUnavailable(
      [itemRevision, unitOfMeasureCode, jobOperationId]
        .filter((value): value is { ok: false; reason: string } => !value.ok)
        .map((value) => value.reason)
        .join("; ")
    );
  }

  return {
    sourceAvailability: "Present",
    snapshot: {
      schema: JOB_MATERIAL_SNAPSHOT_V1,
      jobMaterialId: materialId.value,
      jobId: jobId.value,
      itemId: itemId.value,
      itemRevision: itemRevision.value,
      jobStatus: status as JobMaterialImpactSnapshot["jobStatus"],
      requiredQuantity: required.value,
      issuedQuantity: issued.value,
      remainingQuantity: remaining.value,
      unitOfMeasureCode: unitOfMeasureCode.value,
      methodType: method as JobMaterialImpactSnapshot["methodType"],
      jobOperationId: jobOperationId.value,
      requiresTracking: {
        batch: requiresBatch.value,
        serial: requiresSerial.value
      },
      eligibilityBasis: ACTIVE_JOB_MATERIAL
    }
  };
}

export type ChangeNoticeImpactEligibility =
  | ChangeNoticeImpactExposureClassification
  | "Unavailable";

export function classifyPurchaseOrderLineImpactEligibility(input: {
  purchaseOrderLineType: string;
  purchaseOrderStatus: string;
  receivedComplete: boolean;
  remainingQuantity: number;
  conversionFactor?: number;
}): ChangeNoticeImpactEligibility {
  if (
    !PO_LINE_TYPES.includes(
      input.purchaseOrderLineType as (typeof PO_LINE_TYPES)[number]
    )
  ) {
    return "Unavailable";
  }
  if (
    (purchaseOrderLineImpactNonAssessmentTypes as readonly string[]).includes(
      input.purchaseOrderLineType
    )
  ) {
    return "Historical reference";
  }
  if (
    !impactIn(
      input.purchaseOrderStatus,
      purchaseOrderLineImpactCurrentStatuses
    ) &&
    !impactIn(
      input.purchaseOrderStatus,
      purchaseOrderLineImpactHistoricalStatuses
    )
  ) {
    return "Unavailable";
  }
  const effectiveRemainingQuantity = round(
    input.remainingQuantity * (input.conversionFactor ?? 1)
  );
  if (
    input.receivedComplete ||
    effectiveRemainingQuantity <= 0 ||
    impactIn(
      input.purchaseOrderStatus,
      purchaseOrderLineImpactHistoricalStatuses
    )
  ) {
    return "Historical reference";
  }
  return "Current operational exposure";
}

export function classifyJobImpactEligibility(
  status: string
): ChangeNoticeImpactEligibility {
  if (impactIn(status, jobImpactActiveStatuses))
    return "Current operational exposure";
  if (impactIn(status, jobImpactHistoricalStatuses))
    return "Historical reference";
  return "Unavailable";
}

export function classifyJobMaterialImpactEligibility(
  jobStatus: string
): ChangeNoticeImpactEligibility {
  return classifyJobImpactEligibility(jobStatus);
}

export function deriveChangeNoticeImpactProvenance(input: {
  sourceItemId: string | null;
  currentAffectedItems: Array<{
    id: string;
    itemId: string;
    label: string | null;
  }>;
  persistedProvenance: Array<{
    affectedItemId: string;
    affectedItemSourceId: string;
    affectedItemLabel: string | null;
    endedAt?: string | null;
    endedReason?: string | null;
  }>;
}): {
  currentProvenance: ChangeNoticeImpactProvenance[];
  historicalProvenance: ChangeNoticeImpactProvenance[];
} {
  const currentProvenance = input.currentAffectedItems
    .filter(
      (affected) =>
        input.sourceItemId !== null && affected.itemId === input.sourceItemId
    )
    .map((affected) => ({
      affectedItemId: affected.id,
      affectedItemSourceId: affected.itemId,
      affectedItemLabel: affected.label,
      status: "Current" as const,
      endedReason: null
    }));
  const currentKeys = new Set(
    currentProvenance.map(
      (cause) =>
        `${cause.affectedItemId}${IMPACT_KEY_SEPARATOR}${cause.affectedItemSourceId}`
    )
  );
  const historicalProvenance: ChangeNoticeImpactProvenance[] = [];
  for (const persisted of input.persistedProvenance) {
    const key = `${persisted.affectedItemId}${IMPACT_KEY_SEPARATOR}${persisted.affectedItemSourceId}`;
    if (
      persisted.endedAt === null || persisted.endedAt === undefined
        ? currentKeys.has(key)
        : false
    ) {
      continue;
    }
    // Preserve every ended interval. The same affected item can become the
    // cause again after another cause intervenes; keying this read model by
    // cause would silently erase that repeated history.
    historicalProvenance.push({
      affectedItemId: persisted.affectedItemId,
      affectedItemSourceId: persisted.affectedItemSourceId,
      // Historical labels are optional in persistence. Keep the missing value
      // nullable so the browser can render a localized fallback rather than
      // serializing an English server-side label.
      affectedItemLabel: persisted.affectedItemLabel,
      status: "Historical",
      endedReason: persisted.endedReason ?? "No longer in current scope"
    });
  }
  return {
    currentProvenance,
    historicalProvenance
  };
}

function snapshotKeysMatch(
  value: ImpactRecord,
  expected: readonly string[]
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function snapshotDateOrNull(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string" || !IMPACT_DATE_PATTERN.test(value)) {
    return false;
  }
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}

function snapshotNullableString(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.length > 0);
}

function snapshotNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function snapshotFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function snapshotCanonicalNumber(value: unknown): value is number {
  return snapshotFiniteNumber(value) && value === round(value);
}

function snapshotCanonicalQuantity(value: unknown): value is number {
  return snapshotCanonicalNumber(value) && value >= 0;
}

function snapshotCanonicalNullableQuantity(value: unknown): boolean {
  return value === null || snapshotCanonicalQuantity(value);
}

function snapshotCanonicalFactor(value: unknown): value is number {
  return snapshotCanonicalNumber(value) && value > 0;
}

const SNAPSHOT_ID_KEYS = {
  purchaseOrderLine: "purchaseOrderLineId",
  job: "jobId",
  jobMaterial: "jobMaterialId"
} as const;

function snapshotIdentityValue(
  targetType: ChangeNoticeImpactTargetType,
  value: unknown
): unknown {
  return isImpactRecord(value)
    ? value[SNAPSHOT_ID_KEYS[targetType]]
    : undefined;
}

function snapshotIdentityMatches(
  targetType: ChangeNoticeImpactTargetType,
  value: unknown,
  targetId: unknown
): boolean {
  return snapshotIdentityValue(targetType, value) === targetId;
}

function isCanonicalStoredImpactSnapshot(
  targetType: ChangeNoticeImpactTargetType,
  value: unknown
): value is ChangeNoticeImpactSnapshot {
  if (!isImpactRecord(value)) return false;
  if (!snapshotKeysMatch(value, SNAPSHOT_KEYS[targetType])) return false;

  if (targetType === "purchaseOrderLine") {
    return (
      value.schema === PO_LINE_SNAPSHOT_V1 &&
      snapshotNonEmptyString(value.purchaseOrderLineId) &&
      snapshotNonEmptyString(value.purchaseOrderId) &&
      snapshotNonEmptyString(value.supplierId) &&
      snapshotNonEmptyString(value.itemId) &&
      snapshotNullableString(value.itemRevision) &&
      PO_LINE_TYPES.includes(
        value.purchaseOrderLineType as (typeof PO_LINE_TYPES)[number]
      ) &&
      PO_LINE_STATUS_TYPES.includes(
        value.purchaseOrderStatus as (typeof PO_LINE_STATUS_TYPES)[number]
      ) &&
      typeof value.receivedComplete === "boolean" &&
      snapshotCanonicalQuantity(value.orderedQuantity) &&
      snapshotCanonicalQuantity(value.receivedQuantity) &&
      snapshotCanonicalQuantity(value.remainingQuantity) &&
      snapshotNullableString(value.purchaseUnitOfMeasureCode) &&
      snapshotNullableString(value.inventoryUnitOfMeasureCode) &&
      snapshotCanonicalFactor(value.conversionFactor) &&
      snapshotDateOrNull(value.requiredDate) &&
      snapshotDateOrNull(value.promisedDate) &&
      value.eligibilityBasis === OPEN_PURCHASING_COMMITMENT
    );
  }

  if (targetType === "job") {
    const plannedQuantity = value.plannedQuantity;
    const completedQuantity = value.completedQuantity;
    const remainingQuantity = value.remainingQuantity;
    return (
      value.schema === JOB_SNAPSHOT_V1 &&
      snapshotNonEmptyString(value.jobId) &&
      snapshotNonEmptyString(value.itemId) &&
      snapshotNullableString(value.itemRevision) &&
      JOB_STATUS_TYPES.includes(
        value.status as (typeof JOB_STATUS_TYPES)[number]
      ) &&
      snapshotCanonicalQuantity(plannedQuantity) &&
      snapshotCanonicalQuantity(completedQuantity) &&
      snapshotCanonicalQuantity(remainingQuantity) &&
      remainingQuantity ===
        round(Math.max(plannedQuantity - completedQuantity, 0)) &&
      snapshotCanonicalQuantity(value.quantityShipped) &&
      snapshotCanonicalQuantity(value.quantityReceivedToInventory) &&
      snapshotDateOrNull(value.dueDate) &&
      snapshotNonEmptyString(value.effectiveMethodId) &&
      snapshotCanonicalNumber(value.effectiveMethodVersion) &&
      snapshotNonEmptyString(value.unitOfMeasureCode) &&
      value.eligibilityBasis === ACTIVE_PRODUCING_JOB
    );
  }

  const tracking = value.requiresTracking;
  return (
    value.schema === JOB_MATERIAL_SNAPSHOT_V1 &&
    snapshotNonEmptyString(value.jobMaterialId) &&
    snapshotNonEmptyString(value.jobId) &&
    snapshotNonEmptyString(value.itemId) &&
    snapshotNullableString(value.itemRevision) &&
    JOB_STATUS_TYPES.includes(
      value.jobStatus as (typeof JOB_STATUS_TYPES)[number]
    ) &&
    snapshotCanonicalQuantity(value.requiredQuantity) &&
    snapshotCanonicalNullableQuantity(value.issuedQuantity) &&
    snapshotCanonicalQuantity(value.remainingQuantity) &&
    snapshotNullableString(value.unitOfMeasureCode) &&
    METHOD_TYPES.includes(value.methodType as (typeof METHOD_TYPES)[number]) &&
    snapshotNullableString(value.jobOperationId) &&
    isImpactRecord(tracking) &&
    snapshotKeysMatch(tracking, ["batch", "serial"]) &&
    typeof tracking.batch === "boolean" &&
    typeof tracking.serial === "boolean" &&
    value.eligibilityBasis === ACTIVE_JOB_MATERIAL
  );
}

function impactSnapshotValuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") {
    return round(left) === round(right);
  }
  if (isImpactRecord(left) && isImpactRecord(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) &&
          impactSnapshotValuesEqual(left[key], right[key])
      )
    );
  }
  return Object.is(left, right);
}

/**
 * Compare only canonical snapshot fields. The stored version and exact key set
 * are validated before comparison; cosmetic fields and updatedAt never enter
 * this function.
 */
export function compareChangeNoticeImpactSnapshot(
  targetType: ChangeNoticeImpactTargetType,
  currentSnapshot: ChangeNoticeImpactSnapshot,
  storedSnapshot: unknown,
  snapshotVersion: number
): "Current" | "Changed since assessment" | "Unknown" {
  if (
    snapshotVersion !== 1 ||
    !isCanonicalStoredImpactSnapshot(targetType, storedSnapshot) ||
    storedSnapshot.schema !== currentSnapshot.schema ||
    !snapshotIdentityMatches(
      targetType,
      storedSnapshot,
      snapshotIdentityValue(targetType, currentSnapshot)
    )
  ) {
    return "Unknown";
  }
  return impactSnapshotValuesEqual(currentSnapshot, storedSnapshot)
    ? "Current"
    : "Changed since assessment";
}

/**
 * Create an opaque, non-reversible proof for the browser bulk preview. The
 * source item and affected-item identities are included so a target whose
 * current Change Notice cause changes cannot reuse a fingerprint for unchanged
 * source facts.
 */
export async function createChangeNoticeImpactPreviewFingerprint(input: {
  targetType: ChangeNoticeImpactTargetType;
  snapshot: ChangeNoticeImpactSnapshot;
  affectedItemId: string;
  affectedItemSourceId: string;
}): Promise<string> {
  const encoded = new TextEncoder().encode(
    JSON.stringify({
      targetType: input.targetType,
      affectedItemId: input.affectedItemId,
      affectedItemSourceId: input.affectedItemSourceId,
      snapshot: input.snapshot
    })
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Small aliases make the pure contract easy to discover from the Items barrel.
export const normalizePOLineImpactSnapshot =
  normalizePurchaseOrderLineImpactSnapshot;
export const normalizeJobSnapshot = normalizeJobImpactSnapshot;
export const normalizeJobMaterialSnapshot = normalizeJobMaterialImpactSnapshot;
export const compareImpactSnapshots = compareChangeNoticeImpactSnapshot;

type ImpactSourcePage = {
  rows: ImpactRecord[];
  /** True only when this page began at the first row and reached the end. */
  complete: boolean;
  nextCursor: string | null;
  error: unknown | null;
};

type ImpactCoverageSummary = {
  currentExposureCount: number | null;
  historicalReferenceCount: number | null;
  unassessedCount: number | null;
  /** True when one or more rows could not be semantically classified. */
  partial: boolean;
  error: unknown | null;
  sourceRows: ImpactRecord[];
  currentRows: ImpactRecord[];
  historicalRows: ImpactRecord[];
};

type ImpactStreamPage = {
  rows: ImpactRecord[];
  nextCursor: string | null;
  complete: boolean;
};

// Carbon's id() function uses this Base58 alphabet. The ERP PostgreSQL
// en_US.UTF-8 collation orders those characters as below; using the same
// comparison for the in-memory merge keeps id > cursor continuation aligned
// with the database predicate rather than with a process locale.
const IMPACT_DATABASE_BASE58_ORDER =
  "123456789aAbBcCdDeEfFgGhHijJkKLmMnNopPqQrRsStTuUvVwWxXyYzZ";
const impactDatabaseBase58Ranks = new Map(
  [...IMPACT_DATABASE_BASE58_ORDER].map((character, rank) => [character, rank])
);

function compareImpactIds(left: string, right: string): number {
  if (left === right) return 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftCharacter = left[index];
    const rightCharacter = right[index];
    if (leftCharacter === rightCharacter) continue;
    const leftRank = impactDatabaseBase58Ranks.get(leftCharacter);
    const rightRank = impactDatabaseBase58Ranks.get(rightCharacter);
    if (leftRank !== undefined && rightRank !== undefined) {
      return leftRank - rightRank;
    }
    // Prefixes and legacy identifiers can contain characters outside Base58.
    // Keep that fallback deterministic instead of consulting the host locale.
    return leftCharacter < rightCharacter ? -1 : 1;
  }
  return left.length - right.length;
}

function impactPaginateRows(
  rows: ImpactRecord[],
  cursor: string | null | undefined,
  limit: number
): ImpactStreamPage {
  // The cursor contract has three states: undefined means this stream has not
  // started, a string continues it, and null means it is exhausted. Do not
  // collapse undefined and null or an exhausted stream will restart.
  if (cursor === null) {
    return { rows: [], nextCursor: null, complete: false };
  }

  const ordered = rows
    .filter(
      (row): row is ImpactRecord & { id: string } =>
        typeof row.id === "string" && row.id.length > 0
    )
    .sort((left, right) => compareImpactIds(left.id, right.id));
  const afterCursor =
    cursor === undefined
      ? ordered
      : ordered.filter(
          (row) =>
            typeof row.id === "string" && compareImpactIds(row.id, cursor) > 0
        );
  const pageRows = afterCursor.slice(0, limit);
  const hasMore = afterCursor.length > pageRows.length;
  return {
    rows: pageRows,
    nextCursor:
      hasMore && typeof pageRows.at(-1)?.id === "string"
        ? (pageRows.at(-1)?.id as string)
        : null,
    complete: cursor === undefined && !hasMore
  };
}

function impactCursor(
  options: ResolvedImpactCandidateOptions,
  targetType: ChangeNoticeImpactTargetType,
  stream: "current" | "historical"
): string | null | undefined {
  const domainCursor = options.cursor?.[targetType] as
    | ChangeNoticeImpactDomainCursor
    | null
    | undefined;
  if (domainCursor === null) return null;
  return domainCursor?.[stream];
}

function emptyImpactCoverageSummary(): ImpactCoverageSummary {
  return {
    currentExposureCount: 0,
    historicalReferenceCount: 0,
    unassessedCount: 0,
    partial: false,
    error: null,
    sourceRows: [],
    currentRows: [],
    historicalRows: []
  };
}

type ImpactBatchRows = {
  rows: ImpactRecord[];
  error: unknown | null;
};

type ResolvedImpactCandidateOptions = Omit<
  ChangeNoticeImpactCandidateOptions,
  "sourceAccess"
> & {
  sourceAccess: ChangeNoticeImpactSourceAccess;
};

function impactTargetKey(targetType: string, targetId: string): string {
  return `${targetType}${IMPACT_KEY_SEPARATOR}${targetId}`;
}

function impactPageSize(options: ResolvedImpactCandidateOptions): number {
  if (options.fetchAll && options.limit === undefined) {
    return IMPACT_WORKSPACE_MAX_ROWS_PER_STREAM;
  }
  const requested = options.limit ?? options.pageSize;
  return requested !== undefined && Number.isInteger(requested) && requested > 0
    ? Math.min(requested, IMPACT_PAGE_SIZE)
    : IMPACT_PAGE_SIZE;
}

function impactFallbackOptions(
  options: ResolvedImpactCandidateOptions
): ResolvedImpactCandidateOptions {
  // A failed exact summary cannot support complete materialization. Its
  // fallback only surfaces a bounded unavailable page; never turn the
  // workspace materialization budget into a giant raw PostgREST limit.
  return options.fetchAll ? { ...options, fetchAll: false } : options;
}

async function readPurchaseOrderLineCurrentRows(
  client: SupabaseClient<Database>,
  companyId: string,
  itemIds: string[],
  options: ResolvedImpactCandidateOptions,
  disabled: boolean
): Promise<ImpactSourcePage> {
  if (disabled || itemIds.length === 0) {
    return { rows: [], complete: true, nextCursor: null, error: null };
  }

  const pageSize = impactPageSize(options);
  const initialCursor = impactCursor(options, "purchaseOrderLine", "current");
  if (initialCursor === null) {
    return { rows: [], complete: false, nextCursor: null, error: null };
  }
  const rows: ImpactRecord[] = [];
  for (const batch of impactIdBatches(itemIds)) {
    let query = client
      .from("purchaseOrderLine")
      .select(
        "id, purchaseOrderId, itemId, purchaseOrderLineType, purchaseQuantity, quantityReceived, quantityToReceive, receivedComplete, purchaseUnitOfMeasureCode, inventoryUnitOfMeasureCode, conversionFactor, requiredDate, promisedDate, companyId"
      )
      .eq("companyId", companyId)
      .in("itemId", batch)
      .order("id", { ascending: true })
      .limit(pageSize + 1);
    if (initialCursor !== undefined) query = query.gt("id", initialCursor);

    const result = await query;
    if (result.error) {
      return {
        rows: [],
        complete: false,
        nextCursor: null,
        error: result.error
      };
    }
    rows.push(...impactRecordRows(result.data));
  }

  return {
    ...impactPaginateRows(rows, initialCursor, pageSize),
    error: null
  };
}

async function readJobCurrentRows(
  client: SupabaseClient<Database>,
  companyId: string,
  itemIds: string[],
  options: ResolvedImpactCandidateOptions,
  disabled: boolean
): Promise<ImpactSourcePage> {
  if (disabled || itemIds.length === 0) {
    return { rows: [], complete: true, nextCursor: null, error: null };
  }

  const pageSize = impactPageSize(options);
  const initialCursor = impactCursor(options, "job", "current");
  if (initialCursor === null) {
    return { rows: [], complete: false, nextCursor: null, error: null };
  }
  const rows: ImpactRecord[] = [];
  for (const batch of impactIdBatches(itemIds)) {
    let query = client
      .from("job")
      .select(
        "id, jobId, itemId, status, quantity, quantityComplete, quantityShipped, quantityReceivedToInventory, dueDate, unitOfMeasureCode, companyId"
      )
      .eq("companyId", companyId)
      .in("itemId", batch)
      .order("id", { ascending: true })
      .limit(pageSize + 1);
    if (initialCursor !== undefined) query = query.gt("id", initialCursor);

    const result = await query;
    if (result.error) {
      return {
        rows: [],
        complete: false,
        nextCursor: null,
        error: result.error
      };
    }
    rows.push(...impactRecordRows(result.data));
  }

  return {
    ...impactPaginateRows(rows, initialCursor, pageSize),
    error: null
  };
}

async function readJobMaterialCurrentRows(
  client: SupabaseClient<Database>,
  companyId: string,
  itemIds: string[],
  options: ResolvedImpactCandidateOptions,
  disabled: boolean
): Promise<ImpactSourcePage> {
  if (disabled || itemIds.length === 0) {
    return { rows: [], complete: true, nextCursor: null, error: null };
  }

  const pageSize = impactPageSize(options);
  const initialCursor = impactCursor(options, "jobMaterial", "current");
  if (initialCursor === null) {
    return { rows: [], complete: false, nextCursor: null, error: null };
  }
  const rows: ImpactRecord[] = [];
  for (const batch of impactIdBatches(itemIds)) {
    let query = client
      .from("jobMaterial")
      .select(
        "id, jobId, itemId, estimatedQuantity, quantityIssued, quantityToIssue, unitOfMeasureCode, methodType, jobOperationId, requiresBatchTracking, requiresSerialTracking, companyId"
      )
      .eq("companyId", companyId)
      .in("itemId", batch)
      .order("id", { ascending: true })
      .limit(pageSize + 1);
    if (initialCursor !== undefined) query = query.gt("id", initialCursor);

    const result = await query;
    if (result.error) {
      return {
        rows: [],
        complete: false,
        nextCursor: null,
        error: result.error
      };
    }
    rows.push(...impactRecordRows(result.data));
  }

  return {
    ...impactPaginateRows(rows, initialCursor, pageSize),
    error: null
  };
}

function failedImpactSummary(
  error: unknown,
  sourceRows: ImpactRecord[] = []
): ImpactCoverageSummary {
  return {
    currentExposureCount: null,
    historicalReferenceCount: null,
    unassessedCount: null,
    partial: false,
    error,
    sourceRows,
    currentRows: [],
    historicalRows: []
  };
}

async function readPurchaseOrderLineImpactSummary(
  client: SupabaseClient<Database>,
  companyId: string,
  itemIds: string[],
  persistedIds: string[] = [],
  classificationItemIds: string[] = itemIds
): Promise<ImpactCoverageSummary> {
  if (itemIds.length === 0 && persistedIds.length === 0) {
    return emptyImpactCoverageSummary();
  }

  const result =
    itemIds.length > 0
      ? await readImpactRowsByItemIds(
          client,
          companyId,
          "purchaseOrderLine",
          "id, purchaseOrderId, itemId, purchaseOrderLineType, purchaseQuantity, quantityReceived, quantityToReceive, receivedComplete, purchaseUnitOfMeasureCode, inventoryUnitOfMeasureCode, conversionFactor, requiredDate, promisedDate, companyId",
          itemIds
        )
      : { rows: [], error: null };
  if (result.error) {
    return failedImpactSummary(result.error);
  }
  const liveSourceRows = result.rows;
  const persistedResult = await readPurchaseOrderLineRowsByIds(
    client,
    companyId,
    persistedIds
  );
  if (persistedResult.error) {
    return failedImpactSummary(persistedResult.error);
  }
  const sourceRows = impactMergeRows(liveSourceRows, persistedResult.rows);
  const sourceScanIds = new Set(
    liveSourceRows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : []
    )
  );
  const currentItemIdSet = new Set(classificationItemIds);

  const poIds = sourceRows.flatMap((row) =>
    typeof row.purchaseOrderId === "string" ? [row.purchaseOrderId] : []
  );
  const sourceItemIds = sourceRows.flatMap((row) =>
    typeof row.itemId === "string" ? [row.itemId] : []
  );
  const [parents, deliveries, items] = await Promise.all([
    readImpactPurchaseOrders(client, companyId, poIds),
    readImpactPurchaseOrderDeliveries(client, companyId, poIds),
    readImpactItems(client, companyId, sourceItemIds)
  ]);
  if (parents.error || deliveries.error || items.error) {
    return failedImpactSummary(
      parents.error ?? deliveries.error ?? items.error,
      sourceRows
    );
  }
  const parentById = impactMapRowsById(parents.rows);
  const deliveryById = impactMapRowsById(deliveries.rows);
  const itemById = impactMapRowsById(items.rows);
  const persistedIdSet = new Set(persistedIds);
  const currentRows: ImpactRecord[] = [];
  const historicalRows: ImpactRecord[] = [];
  let partial = false;
  const recordUnavailable = (row: ImpactRecord) => {
    partial = true;
    if (typeof row.id === "string" && sourceScanIds.has(row.id)) {
      currentRows.push(row);
    } else {
      historicalRows.push(row);
    }
  };

  for (const row of sourceRows) {
    const lineType = row.purchaseOrderLineType;
    if (!impactIn(lineType, PO_LINE_TYPES)) {
      recordUnavailable(row);
      continue;
    }
    if (typeof row.id !== "string" || row.id.length === 0) {
      recordUnavailable(row);
      continue;
    }
    if (
      !PO_LINE_ASSESSMENT_TYPES.includes(
        lineType as (typeof PO_LINE_ASSESSMENT_TYPES)[number]
      )
    ) {
      if (persistedIdSet.has(row.id)) historicalRows.push(row);
      continue;
    }

    const parent =
      typeof row.purchaseOrderId === "string"
        ? parentById.get(row.purchaseOrderId)
        : undefined;
    const item =
      typeof row.itemId === "string" ? itemById.get(row.itemId) : undefined;
    const delivery =
      typeof row.purchaseOrderId === "string"
        ? deliveryById.get(row.purchaseOrderId)
        : undefined;
    if (!parent || !item || !delivery) {
      recordUnavailable(row);
      continue;
    }
    const normalized = normalizePurchaseOrderLineImpactSnapshot({
      purchaseOrderLineId: row.id,
      purchaseOrderId: row.purchaseOrderId,
      supplierId: parent.supplierId,
      itemId: row.itemId,
      itemRevision: item.revision,
      purchaseOrderLineType: row.purchaseOrderLineType,
      purchaseOrderStatus: parent.status,
      receivedComplete: row.receivedComplete,
      purchaseQuantity: row.purchaseQuantity,
      quantityReceived: row.quantityReceived,
      quantityToReceive: row.quantityToReceive,
      purchaseUnitOfMeasureCode: row.purchaseUnitOfMeasureCode,
      inventoryUnitOfMeasureCode: row.inventoryUnitOfMeasureCode,
      conversionFactor: row.conversionFactor,
      requiredDate: row.requiredDate,
      promisedDate: row.promisedDate,
      deliveryRowPresent: true,
      deliveryReceiptPromisedDate: delivery.receiptPromisedDate
    });
    if (normalized.sourceAvailability !== "Present") {
      recordUnavailable(row);
      continue;
    }
    const snapshot = normalized.snapshot as PurchaseOrderLineImpactSnapshot;
    const eligibility = classifyPurchaseOrderLineImpactEligibility({
      purchaseOrderLineType: snapshot.purchaseOrderLineType,
      purchaseOrderStatus: snapshot.purchaseOrderStatus,
      receivedComplete: snapshot.receivedComplete,
      remainingQuantity: snapshot.remainingQuantity,
      conversionFactor: snapshot.conversionFactor
    });
    if (eligibility === "Unavailable") {
      recordUnavailable(row);
      continue;
    }
    if (!currentItemIdSet.has(snapshot.itemId)) {
      historicalRows.push(row);
    } else if (eligibility === "Current operational exposure") {
      currentRows.push(row);
    } else {
      historicalRows.push(row);
    }
  }
  return {
    currentExposureCount: partial ? null : currentRows.length,
    historicalReferenceCount: partial ? null : historicalRows.length,
    unassessedCount: partial
      ? null
      : currentRows.filter(
          (row) => typeof row.id === "string" && !persistedIdSet.has(row.id)
        ).length,
    partial,
    error: null,
    sourceRows,
    currentRows,
    historicalRows
  };
}

async function readJobImpactSummary(
  client: SupabaseClient<Database>,
  companyId: string,
  itemIds: string[],
  persistedIds: string[] = [],
  classificationItemIds: string[] = itemIds
): Promise<ImpactCoverageSummary> {
  if (itemIds.length === 0 && persistedIds.length === 0) {
    return emptyImpactCoverageSummary();
  }
  const result =
    itemIds.length > 0
      ? await readImpactRowsByItemIds(
          client,
          companyId,
          "job",
          "id, jobId, itemId, status, quantity, quantityComplete, quantityShipped, quantityReceivedToInventory, dueDate, unitOfMeasureCode, companyId",
          itemIds
        )
      : { rows: [], error: null };
  if (result.error) {
    return failedImpactSummary(result.error);
  }
  const liveSourceRows = result.rows;
  const persistedResult = await readJobRowsByIds(
    client,
    companyId,
    persistedIds
  );
  if (persistedResult.error) {
    return failedImpactSummary(persistedResult.error);
  }
  const sourceRows = impactMergeRows(liveSourceRows, persistedResult.rows);
  const sourceScanIds = new Set(
    liveSourceRows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : []
    )
  );
  const currentItemIdSet = new Set(classificationItemIds);
  const persistedIdSet = new Set(persistedIds);
  const jobIds = sourceRows.flatMap((row) =>
    typeof row.id === "string" ? [row.id] : []
  );
  const itemIdsForRows = sourceRows.flatMap((row) =>
    typeof row.itemId === "string" ? [row.itemId] : []
  );
  const [items, roots] = await Promise.all([
    readImpactItems(client, companyId, itemIdsForRows),
    readImpactJobRootMethods(client, companyId, jobIds)
  ]);
  if (items.error || roots.error) {
    return failedImpactSummary(items.error ?? roots.error, sourceRows);
  }
  const itemById = impactMapRowsById(items.rows);
  const rootByJobId = new Map<string, ImpactRecord>();
  const duplicateRoots = new Set<string>();
  for (const root of roots.rows) {
    if (typeof root.jobId !== "string") continue;
    if (rootByJobId.has(root.jobId)) duplicateRoots.add(root.jobId);
    else rootByJobId.set(root.jobId, root);
  }
  const currentRows: ImpactRecord[] = [];
  const historicalRows: ImpactRecord[] = [];
  let partial = false;
  const recordUnavailable = (row: ImpactRecord) => {
    partial = true;
    if (typeof row.id === "string" && sourceScanIds.has(row.id)) {
      currentRows.push(row);
    } else {
      historicalRows.push(row);
    }
  };

  for (const row of sourceRows) {
    const jobId = typeof row.id === "string" ? row.id : null;
    const item =
      typeof row.itemId === "string" ? itemById.get(row.itemId) : undefined;
    const root = jobId ? rootByJobId.get(jobId) : undefined;
    if (
      !jobId ||
      !item ||
      !root ||
      duplicateRoots.has(jobId) ||
      !impactJobRootMatchesItem(row, root)
    ) {
      recordUnavailable(row);
      continue;
    }
    const normalized = normalizeJobImpactSnapshot({
      jobId: row.id,
      itemId: row.itemId,
      itemRevision: item.revision,
      status: row.status,
      plannedQuantity: row.quantity,
      quantityComplete: row.quantityComplete,
      quantityShipped: row.quantityShipped,
      quantityReceivedToInventory: row.quantityReceivedToInventory,
      dueDate: row.dueDate,
      effectiveMethodId: root.id,
      effectiveMethodVersion: root.version,
      unitOfMeasureCode: row.unitOfMeasureCode
    });
    if (normalized.sourceAvailability !== "Present") {
      recordUnavailable(row);
      continue;
    }
    const snapshot = normalized.snapshot as JobImpactSnapshot;
    if (!currentItemIdSet.has(snapshot.itemId)) {
      historicalRows.push(row);
    } else if (
      classifyJobImpactEligibility(snapshot.status) ===
      "Current operational exposure"
    ) {
      currentRows.push(row);
    } else {
      historicalRows.push(row);
    }
  }
  return {
    currentExposureCount: partial ? null : currentRows.length,
    historicalReferenceCount: partial ? null : historicalRows.length,
    unassessedCount: partial
      ? null
      : currentRows.filter(
          (row) => typeof row.id === "string" && !persistedIdSet.has(row.id)
        ).length,
    partial,
    error: null,
    sourceRows,
    currentRows,
    historicalRows
  };
}

async function readJobMaterialImpactSummary(
  client: SupabaseClient<Database>,
  companyId: string,
  itemIds: string[],
  persistedIds: string[] = [],
  classificationItemIds: string[] = itemIds
): Promise<ImpactCoverageSummary> {
  if (itemIds.length === 0 && persistedIds.length === 0) {
    return emptyImpactCoverageSummary();
  }
  const result =
    itemIds.length > 0
      ? await readImpactRowsByItemIds(
          client,
          companyId,
          "jobMaterial",
          "id, jobId, itemId, estimatedQuantity, quantityIssued, quantityToIssue, unitOfMeasureCode, methodType, jobOperationId, requiresBatchTracking, requiresSerialTracking, companyId",
          itemIds
        )
      : { rows: [], error: null };
  if (result.error) {
    return failedImpactSummary(result.error);
  }
  const liveSourceRows = result.rows;
  const persistedResult = await readJobMaterialRowsByIds(
    client,
    companyId,
    persistedIds
  );
  if (persistedResult.error) {
    return failedImpactSummary(persistedResult.error);
  }
  const sourceRows = impactMergeRows(liveSourceRows, persistedResult.rows);
  const sourceScanIds = new Set(
    liveSourceRows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : []
    )
  );
  const currentItemIdSet = new Set(classificationItemIds);
  const persistedIdSet = new Set(persistedIds);
  const parentIds = sourceRows.flatMap((row) =>
    typeof row.jobId === "string" ? [row.jobId] : []
  );
  const sourceItemIds = sourceRows.flatMap((row) =>
    typeof row.itemId === "string" ? [row.itemId] : []
  );
  const [parents, items] = await Promise.all([
    readJobRowsByIds(client, companyId, parentIds),
    readImpactItems(client, companyId, sourceItemIds)
  ]);
  if (parents.error || items.error) {
    return failedImpactSummary(parents.error ?? items.error, sourceRows);
  }
  const parentById = impactMapRowsById(parents.rows);
  const itemById = impactMapRowsById(items.rows);
  const currentRows: ImpactRecord[] = [];
  const historicalRows: ImpactRecord[] = [];
  let partial = false;
  const recordUnavailable = (row: ImpactRecord) => {
    partial = true;
    if (typeof row.id === "string" && sourceScanIds.has(row.id)) {
      currentRows.push(row);
    } else {
      historicalRows.push(row);
    }
  };

  for (const row of sourceRows) {
    const parent =
      typeof row.jobId === "string" ? parentById.get(row.jobId) : undefined;
    const item =
      typeof row.itemId === "string" ? itemById.get(row.itemId) : undefined;
    if (!parent || !item) {
      recordUnavailable(row);
      continue;
    }
    const normalized = normalizeJobMaterialImpactSnapshot({
      jobMaterialId: row.id,
      jobId: row.jobId,
      itemId: row.itemId,
      itemRevision: item.revision,
      jobStatus: parent.status,
      estimatedQuantity: row.estimatedQuantity,
      quantityIssued: row.quantityIssued,
      quantityToIssue: row.quantityToIssue,
      unitOfMeasureCode: row.unitOfMeasureCode,
      methodType: row.methodType,
      jobOperationId: row.jobOperationId,
      requiresBatchTracking: row.requiresBatchTracking,
      requiresSerialTracking: row.requiresSerialTracking
    });
    if (normalized.sourceAvailability !== "Present") {
      recordUnavailable(row);
      continue;
    }
    const snapshot = normalized.snapshot as JobMaterialImpactSnapshot;
    if (!currentItemIdSet.has(snapshot.itemId)) {
      historicalRows.push(row);
    } else if (
      classifyJobMaterialImpactEligibility(snapshot.jobStatus) ===
      "Current operational exposure"
    ) {
      currentRows.push(row);
    } else {
      historicalRows.push(row);
    }
  }
  return {
    currentExposureCount: partial ? null : currentRows.length,
    historicalReferenceCount: partial ? null : historicalRows.length,
    unassessedCount: partial
      ? null
      : currentRows.filter(
          (row) => typeof row.id === "string" && !persistedIdSet.has(row.id)
        ).length,
    partial,
    error: null,
    sourceRows,
    currentRows,
    historicalRows
  };
}

function impactSummaryWithPersistedHistorical(
  summary: ImpactCoverageSummary,
  persistedIds: string[],
  sourceRows: ImpactRecord[],
  sourceScanComplete: boolean
): ImpactCoverageSummary {
  if (summary.error || summary.historicalReferenceCount === null) {
    return summary;
  }

  const sourceById = impactMapRowsById(sourceRows);
  let extraHistoricalCount = 0;
  for (const targetId of new Set(persistedIds)) {
    if (!sourceById.has(targetId)) {
      if (!sourceScanComplete)
        return { ...summary, historicalReferenceCount: null };
      extraHistoricalCount += 1;
    }
  }

  return {
    ...summary,
    historicalReferenceCount:
      summary.historicalReferenceCount + extraHistoricalCount
  };
}

function impactIdBatches(ids: string[]): string[][] {
  const uniqueIds = [...new Set(ids)];
  const batches: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += IMPACT_ID_BATCH_SIZE) {
    batches.push(uniqueIds.slice(index, index + IMPACT_ID_BATCH_SIZE));
  }
  return batches;
}

type ImpactItemIdTable = "purchaseOrderLine" | "job" | "jobMaterial";

async function readImpactRowsByItemIds(
  client: SupabaseClient<Database>,
  companyId: string,
  table: ImpactItemIdTable,
  selectColumns: string,
  itemIds: string[]
): Promise<ImpactBatchRows> {
  const rows: ImpactRecord[] = [];
  for (const batch of impactIdBatches(itemIds)) {
    const result = await fetchAllFromTable<ImpactRecord>(
      client,
      table,
      selectColumns,
      (query) =>
        query
          .eq("companyId", companyId)
          .in("itemId", batch)
          .order("id", { ascending: true })
    );
    if (result.error || !result.data) {
      return {
        rows: [],
        error: result.error ?? new Error(`${table} Impact scan failed`)
      };
    }
    rows.push(...impactRecordRows(result.data));
  }
  return { rows, error: null };
}

async function readPurchaseOrderLineRowsByIds(
  client: SupabaseClient<Database>,
  companyId: string,
  ids: string[]
): Promise<ImpactBatchRows> {
  const rows: ImpactRecord[] = [];
  for (const batch of impactIdBatches(ids)) {
    const result = await client
      .from("purchaseOrderLine")
      .select(
        "id, purchaseOrderId, itemId, purchaseOrderLineType, purchaseQuantity, quantityReceived, quantityToReceive, receivedComplete, purchaseUnitOfMeasureCode, inventoryUnitOfMeasureCode, conversionFactor, requiredDate, promisedDate, companyId"
      )
      .eq("companyId", companyId)
      .in("id", batch);
    if (result.error) return { rows: [], error: result.error };
    rows.push(...impactRecordRows(result.data));
  }
  return { rows, error: null };
}

async function readJobRowsByIds(
  client: SupabaseClient<Database>,
  companyId: string,
  ids: string[]
): Promise<ImpactBatchRows> {
  const rows: ImpactRecord[] = [];
  for (const batch of impactIdBatches(ids)) {
    const result = await client
      .from("job")
      .select(
        "id, jobId, itemId, status, quantity, quantityComplete, quantityShipped, quantityReceivedToInventory, dueDate, unitOfMeasureCode, companyId"
      )
      .eq("companyId", companyId)
      .in("id", batch);
    if (result.error) return { rows: [], error: result.error };
    rows.push(...impactRecordRows(result.data));
  }
  return { rows, error: null };
}

async function readJobMaterialRowsByIds(
  client: SupabaseClient<Database>,
  companyId: string,
  ids: string[]
): Promise<ImpactBatchRows> {
  const rows: ImpactRecord[] = [];
  for (const batch of impactIdBatches(ids)) {
    const result = await client
      .from("jobMaterial")
      .select(
        "id, jobId, itemId, estimatedQuantity, quantityIssued, quantityToIssue, unitOfMeasureCode, methodType, jobOperationId, requiresBatchTracking, requiresSerialTracking, companyId"
      )
      .eq("companyId", companyId)
      .in("id", batch);
    if (result.error) return { rows: [], error: result.error };
    rows.push(...impactRecordRows(result.data));
  }
  return { rows, error: null };
}

async function readImpactItems(
  client: SupabaseClient<Database>,
  companyId: string,
  ids: string[]
): Promise<ImpactBatchRows> {
  const rows: ImpactRecord[] = [];
  for (const batch of impactIdBatches(ids)) {
    const result = await client
      .from("item")
      .select(
        "id, readableId, readableIdWithRevision, revision, unitOfMeasureCode, companyId"
      )
      .eq("companyId", companyId)
      .in("id", batch);
    if (result.error) return { rows: [], error: result.error };
    rows.push(...impactRecordRows(result.data));
  }
  return { rows, error: null };
}

async function readImpactPurchaseOrders(
  client: SupabaseClient<Database>,
  companyId: string,
  ids: string[]
): Promise<ImpactBatchRows> {
  const rows: ImpactRecord[] = [];
  for (const batch of impactIdBatches(ids)) {
    const result = await client
      .from("purchaseOrder")
      .select(
        "id, purchaseOrderId, supplierId, status, companyId, supplier(name)"
      )
      .eq("companyId", companyId)
      .in("id", batch);
    if (result.error) return { rows: [], error: result.error };
    rows.push(...impactRecordRows(result.data));
  }
  return { rows, error: null };
}

async function readImpactPurchaseOrderDeliveries(
  client: SupabaseClient<Database>,
  companyId: string,
  ids: string[]
): Promise<ImpactBatchRows> {
  const rows: ImpactRecord[] = [];
  for (const batch of impactIdBatches(ids)) {
    const result = await client
      .from("purchaseOrderDelivery")
      .select("id, receiptPromisedDate, companyId")
      .eq("companyId", companyId)
      .in("id", batch);
    if (result.error) return { rows: [], error: result.error };
    rows.push(...impactRecordRows(result.data));
  }
  return { rows, error: null };
}

async function readImpactJobRootMethods(
  client: SupabaseClient<Database>,
  companyId: string,
  jobIds: string[]
): Promise<ImpactBatchRows> {
  if (jobIds.length === 0) return { rows: [], error: null };
  const rows: ImpactRecord[] = [];
  for (const batch of impactIdBatches(jobIds)) {
    const result = await fetchAllFromTable<ImpactRecord>(
      client,
      "jobMakeMethod",
      "id, jobId, itemId, version, parentMaterialId, companyId",
      (query) =>
        query
          .eq("companyId", companyId)
          .in("jobId", batch)
          .is("parentMaterialId", null)
          .order("jobId", { ascending: true })
          .order("id", { ascending: true })
    );
    if (result.error || !result.data) {
      return {
        rows: [],
        error: result.error ?? new Error("Job root method scan failed")
      };
    }
    rows.push(...impactRecordRows(result.data));
  }
  return { rows, error: null };
}

type ImpactPersistedProvenance = {
  affectedItemId: string;
  affectedItemSourceId: string;
  affectedItemLabel: string | null;
  endedAt: string | null;
  endedReason: string | null;
};

type ImpactPersistedDecision = {
  id: string;
  targetType: ChangeNoticeImpactTargetType;
  targetId: string;
  projection: ChangeNoticeImpactDecisionProjection | null;
  snapshotIssue: string | null;
  provenance: ImpactPersistedProvenance[];
};

type ImpactPersistedState = {
  byTarget: Map<string, ImpactPersistedDecision>;
  byId: Map<string, ImpactPersistedDecision>;
  partialTargetTypes: Set<ChangeNoticeImpactTargetType>;
  error: unknown | null;
};

function impactSourceAccessTypes(
  options: ResolvedImpactCandidateOptions
): ChangeNoticeImpactTargetType[] {
  const accessible: ChangeNoticeImpactTargetType[] = [];
  if (options.sourceAccess.purchaseOrderLine) {
    accessible.push("purchaseOrderLine");
  }
  // Job and Job Material both inherit production_view. If a caller supplies an
  // inconsistent partial capability map, fail closed for the whole production
  // domain rather than hydrating a parent Job through the material path.
  if (options.sourceAccess.job && options.sourceAccess.jobMaterial) {
    accessible.push("job", "jobMaterial");
  }
  return accessible;
}

async function readImpactPersistedState(
  client: SupabaseClient<Database>,
  companyId: string,
  changeNoticeId: string,
  options: ResolvedImpactCandidateOptions
): Promise<ImpactPersistedState> {
  const accessibleTypes = impactSourceAccessTypes(options);
  if (accessibleTypes.length === 0) {
    return {
      byTarget: new Map(),
      byId: new Map(),
      partialTargetTypes: new Set(),
      error: null
    };
  }

  const decisionResult = await fetchAllFromTable<ImpactRecord>(
    client,
    "changeOrderImpactDecision",
    "id, targetType, targetId, decisionStatus, noActionReasonCode, rationale, resolutionNote, revision, snapshotVersion, assessmentSnapshot, companyId, changeNoticeId",
    (query) =>
      query
        .eq("companyId", companyId)
        .eq("changeNoticeId", changeNoticeId)
        .in("targetType", accessibleTypes)
        .order("id", { ascending: true })
  );
  if (decisionResult.error || !decisionResult.data) {
    logger.error("Failed to read persisted Change Notice Impact decisions", {
      error: decisionResult.error,
      companyId,
      changeNoticeId
    });
    return {
      byTarget: new Map(),
      byId: new Map(),
      partialTargetTypes: new Set(),
      error:
        decisionResult.error ??
        new Error("Persisted Change Notice Impact decisions unavailable")
    };
  }

  const byTarget = new Map<string, ImpactPersistedDecision>();
  const byId = new Map<string, ImpactPersistedDecision>();
  const partialTargetTypes = new Set<ChangeNoticeImpactTargetType>();
  const decisionRows = impactRecordRows(decisionResult.data);
  for (const row of decisionRows) {
    const targetType = row.targetType;
    if (!impactIn(targetType, changeNoticeImpactTargetTypes)) continue;

    const id = impactPersistedRequiredString(row.id, "decision.id");
    const targetId = impactPersistedRequiredString(
      row.targetId,
      "decision.targetId"
    );
    if (!id.ok || !targetId.ok) {
      partialTargetTypes.add(targetType);
      continue;
    }

    const status = row.decisionStatus;
    const reason = row.noActionReasonCode;
    const revision = impactNumber(row.revision, "decision.revision");
    const snapshotVersion = impactNumber(
      row.snapshotVersion,
      "decision.snapshotVersion"
    );
    const statusValid = impactIn(status, changeNoticeImpactDecisionStatuses);
    const reasonValid =
      reason === null ||
      reason === undefined ||
      impactIn(reason, changeNoticeImpactNoActionReasonCodes);
    const revisionValid = revision.ok;
    const versionValid =
      snapshotVersion.ok && Number.isInteger(snapshotVersion.value);
    const rawSnapshot = row.assessmentSnapshot;
    const persistedSnapshot =
      versionValid &&
      snapshotVersion.value === 1 &&
      isCanonicalStoredImpactSnapshot(targetType, rawSnapshot) &&
      snapshotIdentityMatches(targetType, rawSnapshot, targetId.value)
        ? rawSnapshot
        : null;
    const snapshotIssue =
      !versionValid || snapshotVersion.value !== 1
        ? "Unsupported assessment snapshot version"
        : persistedSnapshot === null
          ? "Stored assessment snapshot has an unsupported shape"
          : null;

    const projection =
      statusValid && reasonValid && revisionValid && versionValid
        ? {
            id: id.value,
            status: status as ChangeNoticeImpactDecisionProjection["status"],
            decisionStatus:
              status as ChangeNoticeImpactDecisionProjection["decisionStatus"],
            noActionReasonCode: (reason ??
              null) as ChangeNoticeImpactDecisionProjection["noActionReasonCode"],
            rationale: impactNullableString(row.rationale),
            resolutionNote: impactNullableString(row.resolutionNote),
            revision: revision.value,
            snapshotVersion: snapshotVersion.value,
            persistedSnapshot
          }
        : null;

    const persisted: ImpactPersistedDecision = {
      id: id.value,
      targetType,
      targetId: targetId.value,
      projection,
      snapshotIssue:
        projection === null
          ? "Stored Impact decision has an unsupported shape"
          : snapshotIssue,
      provenance: []
    };
    if (persisted.projection === null || persisted.snapshotIssue !== null) {
      partialTargetTypes.add(targetType);
    }
    byTarget.set(impactTargetKey(targetType, targetId.value), persisted);
    byId.set(id.value, persisted);
  }

  const decisionIds = [...byId.keys()];
  if (decisionIds.length === 0) {
    return { byTarget, byId, partialTargetTypes, error: null };
  }

  const provenanceRows: ImpactRecord[] = [];
  for (const batch of impactIdBatches(decisionIds)) {
    const result = await fetchAllFromTable<ImpactRecord>(
      client,
      "changeOrderImpactDecisionAffectedItem",
      "id, decisionId, affectedItemId, affectedItemSourceId, affectedItemLabel, endedAt, endedReason, companyId",
      (query) =>
        query
          .eq("companyId", companyId)
          .in("decisionId", batch)
          .order("decisionId", { ascending: true })
          .order("affectedItemId", { ascending: true })
          .order("id", { ascending: true })
    );
    if (result.error || !result.data) {
      logger.error("Failed to read persisted Change Notice Impact provenance", {
        error: result.error,
        companyId,
        changeNoticeId
      });
      return {
        byTarget,
        byId,
        partialTargetTypes,
        error:
          result.error ??
          new Error("Persisted Change Notice Impact provenance unavailable")
      };
    }
    provenanceRows.push(...impactRecordRows(result.data));
  }

  for (const row of provenanceRows) {
    const decisionId = row.decisionId;
    if (typeof decisionId !== "string") continue;
    const decision = byId.get(decisionId);
    if (!decision) continue;
    const affectedItemId = impactPersistedRequiredString(
      row.affectedItemId,
      "provenance.affectedItemId"
    );
    const sourceId = impactPersistedRequiredString(
      row.affectedItemSourceId,
      "provenance.affectedItemSourceId"
    );
    if (!affectedItemId.ok || !sourceId.ok) {
      partialTargetTypes.add(decision.targetType);
      continue;
    }
    decision.provenance.push({
      affectedItemId: affectedItemId.value,
      affectedItemSourceId: sourceId.value,
      affectedItemLabel: impactNullableString(row.affectedItemLabel),
      endedAt: impactNullableString(row.endedAt),
      endedReason: impactNullableString(row.endedReason)
    });
  }

  return { byTarget, byId, partialTargetTypes, error: null };
}

function impactMapRowsById(rows: ImpactRecord[]): Map<string, ImpactRecord> {
  const map = new Map<string, ImpactRecord>();
  for (const row of rows) {
    if (typeof row.id === "string") map.set(row.id, row);
  }
  return map;
}

function impactJobRootMatchesItem(
  job: ImpactRecord,
  root: ImpactRecord
): boolean {
  return (
    typeof job.itemId === "string" &&
    typeof root.itemId === "string" &&
    job.itemId === root.itemId
  );
}

function impactMergeRows(
  first: ImpactRecord[],
  second: ImpactRecord[]
): ImpactRecord[] {
  const byId = new Map<string, ImpactRecord>();
  for (const row of [...first, ...second]) {
    if (typeof row.id === "string" && !byId.has(row.id)) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

function impactAffectedItemLabel(
  row: ImpactRecord & { item?: ImpactRecord | null }
): string | null {
  const item = isImpactRecord(row.item) ? row.item : null;
  return (
    impactNullableString(item ? item.readableIdWithRevision : null) ??
    impactNullableString(item ? item.readableId : null) ??
    impactNullableString(item ? item.name : null)
  );
}

function impactCurrentAffectedItems(
  rows: Array<ImpactRecord & { item?: ImpactRecord | null }>
): Array<{ id: string; itemId: string; label: string | null }> {
  return rows.flatMap((row) => {
    const id = impactRequiredString(row.id, "affectedItem.id");
    const itemId = impactRequiredString(row.itemId, "affectedItem.itemId");
    if (!id.ok || !itemId.ok) return [];
    return [
      {
        id: id.value,
        itemId: itemId.value,
        label: impactAffectedItemLabel(row)
      }
    ];
  });
}

function impactCandidateWithState(args: {
  targetType: ChangeNoticeImpactTargetType;
  targetId: string;
  sourceItemId: string | null;
  currentAffectedItems: Array<{
    id: string;
    itemId: string;
    label: string | null;
  }>;
  persisted: ImpactPersistedDecision | undefined;
  parent: ChangeNoticeImpactParentContext | null;
  item: ChangeNoticeImpactItemContext | null;
  snapshot: ChangeNoticeImpactSnapshot | null;
  sourceAvailability: ChangeNoticeImpactCandidate["sourceAvailability"];
  unavailableReason: string | null;
  exposureClassification: ChangeNoticeImpactCandidate["exposureClassification"];
}): ChangeNoticeImpactCandidate {
  const provenance = deriveChangeNoticeImpactProvenance({
    sourceItemId: args.sourceItemId,
    currentAffectedItems: args.currentAffectedItems,
    persistedProvenance: args.persisted?.provenance ?? []
  });
  let sourceAvailability = args.sourceAvailability;
  let unavailableReason = args.unavailableReason;
  let freshness: ChangeNoticeImpactCandidate["freshness"] = null;
  const decision = args.persisted?.projection ?? null;

  if (args.persisted?.projection === null && args.persisted !== undefined) {
    sourceAvailability = "Unavailable";
    unavailableReason =
      args.persisted.snapshotIssue ?? "Stored Impact decision is unavailable";
  } else if (decision) {
    if (args.persisted?.snapshotIssue) {
      // The live source remains authoritative even when the persisted snapshot
      // cannot be compared. Keep its facts and exposure visible, but withhold
      // freshness rather than relabeling a readable source as unavailable.
      freshness = "Unknown";
    } else if (args.snapshot) {
      freshness = compareChangeNoticeImpactSnapshot(
        args.targetType,
        args.snapshot,
        decision.persistedSnapshot,
        decision.snapshotVersion
      );
    } else {
      freshness = "Unknown";
    }
  }

  return {
    targetType: args.targetType,
    targetId: args.targetId,
    parent: args.parent,
    item: args.item,
    currentSnapshot: args.snapshot,
    currentProvenance: provenance.currentProvenance,
    historicalProvenance: provenance.historicalProvenance,
    provenance: [
      ...provenance.currentProvenance,
      ...provenance.historicalProvenance
    ],
    exposureClassification: args.exposureClassification,
    sourceAvailability,
    unavailableReason,
    decision,
    freshness
  };
}

function impactCandidatesUnavailableWhenPersistedStateFails(
  candidates: ChangeNoticeImpactCandidate[],
  persistedStateError: unknown | null,
  fallbackReason = "Persisted Impact state is unavailable."
): ChangeNoticeImpactCandidate[] {
  if (!persistedStateError) return candidates;
  return candidates.map((candidate) => ({
    ...candidate,
    // A failed persisted-state read means the service cannot prove which
    // decision/provenance data belongs to this candidate. Keep only the
    // target identity needed to describe the unavailable row.
    parent: null,
    item: null,
    currentSnapshot: null,
    currentProvenance: [],
    historicalProvenance: [],
    provenance: [],
    exposureClassification: null,
    sourceAvailability: "Unavailable" as const,
    unavailableReason: candidate.unavailableReason ?? fallbackReason,
    decision: null,
    freshness: "Unknown" as const
  }));
}

// A query or batch-hydration failure invalidates every selected fact in the
// domain. Row-local semantic failures are recorded as partial coverage instead
// and must never come through this domain-wide fail-closed path.
function impactCandidatesUnavailableWhenSourceCoverageFails(
  candidates: ChangeNoticeImpactCandidate[],
  sourceCoverageError: unknown | null,
  fallbackReason: string
): ChangeNoticeImpactCandidate[] {
  if (!sourceCoverageError) return candidates;
  return candidates.map((candidate) => ({
    ...candidate,
    // A failed source read invalidates every source-derived and persisted
    // projection that could otherwise be mistaken for currently authorized
    // evidence. Keep only the target key needed to report an unavailable row.
    parent: null,
    item: null,
    currentSnapshot: null,
    currentProvenance: [],
    historicalProvenance: [],
    provenance: [],
    exposureClassification: null,
    sourceAvailability: "Unavailable" as const,
    unavailableReason: candidate.unavailableReason ?? fallbackReason,
    decision: null,
    freshness: "Unknown" as const
  }));
}

type ImpactDomainDiscovery = {
  candidates: ChangeNoticeImpactCandidate[];
  coverage: ChangeNoticeImpactCoverage;
};

function impactCoverage(
  targetType: ChangeNoticeImpactTargetType,
  status: ChangeNoticeImpactCoverage["status"],
  nextCursor:
    | { current: string | null; historical: string | null }
    | string
    | null,
  candidates: ChangeNoticeImpactCandidate[],
  errorMessage?: string,
  summary?: ImpactCoverageSummary
): ChangeNoticeImpactCoverage {
  const normalizedNextCursor =
    typeof nextCursor === "string"
      ? { current: nextCursor, historical: null }
      : (nextCursor ?? { current: null, historical: null });
  if (status !== "complete") {
    return {
      targetType,
      status,
      currentExposureCount: null,
      historicalReferenceCount: null,
      unassessedCount: null,
      ...(errorMessage ? { errorMessage } : {}),
      nextCursor: normalizedNextCursor
    };
  }

  const hasUnavailable = candidates.some(
    (candidate) => candidate.sourceAvailability === "Unavailable"
  );
  return {
    targetType,
    status,
    // These counts come from the independent exact summary query, never from
    // the visible candidate page. A page can have a cursor while the summary
    // remains complete and trustworthy.
    currentExposureCount:
      hasUnavailable || summary?.error
        ? null
        : (summary?.currentExposureCount ?? null),
    historicalReferenceCount:
      hasUnavailable || summary?.error
        ? null
        : (summary?.historicalReferenceCount ?? null),
    // This count comes from the same independent complete summary as the
    // exposure totals, not from the visible candidate page.
    unassessedCount:
      hasUnavailable || summary?.error
        ? null
        : (summary?.unassessedCount ?? null),
    nextCursor: normalizedNextCursor
  };
}

function impactMapItems(rows: ImpactBatchRows): Map<string, ImpactRecord> {
  return impactMapRowsById(rows.rows);
}

async function discoverPurchaseOrderLineImpact(
  client: SupabaseClient<Database>,
  companyId: string,
  currentAffectedItems: Array<{
    id: string;
    itemId: string;
    label: string | null;
  }>,
  changeNoticeStatus: string,
  persisted: ImpactPersistedState,
  options: ResolvedImpactCandidateOptions
): Promise<ImpactDomainDiscovery> {
  const targetType = "purchaseOrderLine" as const;
  if (!options.sourceAccess.purchaseOrderLine) {
    return {
      candidates: [],
      coverage: impactCoverage(
        targetType,
        "restricted",
        null,
        [],
        "Purchasing source access is restricted."
      )
    };
  }

  const currentItemIds =
    changeNoticeStatus === "Cancelled"
      ? []
      : [...new Set(currentAffectedItems.map((item) => item.itemId))];
  const classificationItemIds = [
    ...new Set(currentAffectedItems.map((item) => item.itemId))
  ];
  const persistedIds = [...persisted.byTarget.values()]
    .filter((decision) => decision.targetType === targetType)
    .map((decision) => decision.targetId);
  const summary = await readPurchaseOrderLineImpactSummary(
    client,
    companyId,
    currentItemIds,
    persistedIds,
    classificationItemIds
  );
  const currentRows: ImpactSourcePage = summary.error
    ? await readPurchaseOrderLineCurrentRows(
        client,
        companyId,
        currentItemIds,
        impactFallbackOptions(options),
        false
      )
    : (() => {
        const page = impactPaginateRows(
          summary.currentRows,
          impactCursor(options, targetType, "current"),
          impactPageSize(options)
        );
        return { ...page, error: null };
      })();
  const persistedIdSet = new Set(persistedIds);
  const persistedRows = summary.error
    ? await readPurchaseOrderLineRowsByIds(client, companyId, persistedIds)
    : {
        rows: summary.sourceRows.filter(
          (row) => typeof row.id === "string" && persistedIdSet.has(row.id)
        ),
        error: null
      };
  const scannedIds = new Set(
    summary.sourceRows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : []
    )
  );
  const persistedHistoricalPlaceholders = persistedIds
    .filter((id) => !scannedIds.has(id))
    .map((id) => ({ id, __impactPlaceholder: true }));
  const currentSourceIds = new Set(
    summary.currentRows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : []
    )
  );
  const persistedHistoricalRows = persistedRows.rows.filter(
    (row) => typeof row.id !== "string" || !currentSourceIds.has(row.id)
  );
  const historicalPool = impactMergeRows(
    summary.historicalRows,
    impactMergeRows(persistedHistoricalRows, persistedHistoricalPlaceholders)
  );
  const historicalRows = impactPaginateRows(
    historicalPool,
    impactCursor(options, targetType, "historical"),
    impactPageSize(options)
  );
  const selectedIds = new Set([
    ...currentRows.rows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : []
    ),
    ...historicalRows.rows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : []
    )
  ]);
  const sourceRows = impactMergeRows(
    impactMergeRows(currentRows.rows, historicalRows.rows),
    persistedRows.rows.filter((row) => selectedIds.has(row.id as string))
  );
  const sourceById = impactMapRowsById(sourceRows);
  const coverageSummary = impactSummaryWithPersistedHistorical(
    summary,
    persistedIds,
    summary.sourceRows,
    !summary.error && !summary.partial
  );
  const targetIds = [...selectedIds];

  const poIds = sourceRows.flatMap((row) =>
    typeof row.purchaseOrderId === "string" ? [row.purchaseOrderId] : []
  );
  const itemIds = sourceRows.flatMap((row) =>
    typeof row.itemId === "string" ? [row.itemId] : []
  );
  const [purchaseOrders, deliveries, items] = await Promise.all([
    readImpactPurchaseOrders(client, companyId, poIds),
    readImpactPurchaseOrderDeliveries(client, companyId, poIds),
    readImpactItems(client, companyId, itemIds)
  ]);
  const purchaseOrderById = impactMapItems(purchaseOrders);
  const deliveryById = impactMapItems(deliveries);
  const itemById = impactMapItems(items);
  const sourceCoverageError =
    currentRows.error ??
    persistedRows.error ??
    coverageSummary.error ??
    purchaseOrders.error ??
    deliveries.error ??
    items.error;
  const sourceFailed = !!sourceCoverageError || !!persisted.error;
  const candidates: ChangeNoticeImpactCandidate[] = [];

  for (const targetId of targetIds) {
    const persistedDecision = persisted.byTarget.get(
      impactTargetKey(targetType, targetId)
    );
    const row = sourceById.get(targetId);
    if (!row || row.__impactPlaceholder === true) {
      const unavailable =
        sourceFailed ||
        summary.partial ||
        persisted.partialTargetTypes.has(targetType)
          ? "Coverage is incomplete; source deletion cannot be established."
          : null;
      candidates.push(
        impactCandidateWithState({
          targetType,
          targetId,
          sourceItemId: null,
          currentAffectedItems,
          persisted: persistedDecision,
          parent: null,
          item: null,
          snapshot: null,
          sourceAvailability: unavailable ? "Unavailable" : "Source deleted",
          unavailableReason: unavailable,
          exposureClassification: unavailable ? null : "Historical reference"
        })
      );
      continue;
    }

    const sourceItemId = typeof row.itemId === "string" ? row.itemId : null;
    const lineType = row.purchaseOrderLineType;
    const parentRow =
      typeof row.purchaseOrderId === "string"
        ? purchaseOrderById.get(row.purchaseOrderId)
        : undefined;
    const itemRow = sourceItemId ? itemById.get(sourceItemId) : undefined;
    const parentId = impactRequiredString(
      row.purchaseOrderId,
      "purchaseOrderLine.purchaseOrderId"
    );
    const parentReadableId = parentRow
      ? impactRequiredString(
          impactValue(parentRow, "purchaseOrderId"),
          "purchaseOrder.purchaseOrderId"
        )
      : { ok: false as const, reason: "purchaseOrder parent is unavailable" };
    const parentSupplierId = parentRow
      ? impactRequiredString(
          impactValue(parentRow, "supplierId"),
          "purchaseOrder.supplierId"
        )
      : { ok: false as const, reason: "purchaseOrder parent is unavailable" };
    const parentStatus = parentRow
      ? impactRequiredString(
          impactValue(parentRow, "status"),
          "purchaseOrder.status"
        )
      : { ok: false as const, reason: "purchaseOrder parent is unavailable" };
    // The relation is selected only through the authorized, company-scoped
    // purchase-order read. Never fall back to supplierId when the display name
    // is unavailable.
    const parentSupplierName = parentRow
      ? impactRelatedName(impactValue(parentRow, "supplier"))
      : null;

    // Non-assessment PO line types are excluded from new discovery. A persisted
    // row is retained as a historical reference rather than silently dropped.
    if (
      (purchaseOrderLineImpactNonAssessmentTypes as readonly string[]).includes(
        typeof lineType === "string" ? lineType : ""
      ) &&
      !persistedDecision
    ) {
      continue;
    }

    if (
      !parentId.ok ||
      !parentReadableId.ok ||
      !parentSupplierId.ok ||
      !parentStatus.ok
    ) {
      candidates.push(
        impactCandidateWithState({
          targetType,
          targetId,
          sourceItemId,
          currentAffectedItems,
          persisted: persistedDecision,
          parent: null,
          item: null,
          snapshot: null,
          sourceAvailability: "Unavailable",
          unavailableReason:
            "Required purchase-order parent facts are unavailable.",
          exposureClassification: null
        })
      );
      continue;
    }

    const parent: ChangeNoticeImpactParentContext = {
      type: "purchaseOrder",
      id: parentId.value,
      readableId: parentReadableId.value,
      status: parentStatus.value,
      supplierName: parentSupplierName
    };

    if (
      (purchaseOrderLineImpactNonAssessmentTypes as readonly string[]).includes(
        typeof lineType === "string" ? lineType : ""
      )
    ) {
      candidates.push(
        impactCandidateWithState({
          targetType,
          targetId,
          sourceItemId,
          currentAffectedItems,
          persisted: persistedDecision,
          parent,
          item: null,
          snapshot: null,
          sourceAvailability: "Present",
          unavailableReason: null,
          exposureClassification: "Historical reference"
        })
      );
      continue;
    }

    if (!itemRow) {
      candidates.push(
        impactCandidateWithState({
          targetType,
          targetId,
          sourceItemId,
          currentAffectedItems,
          persisted: persistedDecision,
          parent,
          item: null,
          snapshot: null,
          sourceAvailability: "Unavailable",
          unavailableReason: "Required item facts are unavailable.",
          exposureClassification: null
        })
      );
      continue;
    }

    const deliveryRow = deliveryById.get(parent.id);
    if (!deliveryRow) {
      candidates.push(
        impactCandidateWithState({
          targetType,
          targetId,
          sourceItemId,
          currentAffectedItems,
          persisted: persistedDecision,
          parent,
          item: null,
          snapshot: null,
          sourceAvailability: "Unavailable",
          unavailableReason:
            "Required purchase-order delivery facts are unavailable.",
          exposureClassification: null
        })
      );
      continue;
    }

    const snapshotResult = normalizePurchaseOrderLineImpactSnapshot({
      purchaseOrderLineId: row.id,
      purchaseOrderId: row.purchaseOrderId,
      supplierId: parentSupplierId.value,
      itemId: row.itemId,
      itemRevision: impactValue(itemRow, "revision"),
      purchaseOrderLineType: row.purchaseOrderLineType,
      purchaseOrderStatus: parent.status,
      receivedComplete: row.receivedComplete,
      purchaseQuantity: row.purchaseQuantity,
      quantityReceived: row.quantityReceived,
      quantityToReceive: row.quantityToReceive,
      purchaseUnitOfMeasureCode: row.purchaseUnitOfMeasureCode,
      inventoryUnitOfMeasureCode: row.inventoryUnitOfMeasureCode,
      conversionFactor: row.conversionFactor,
      requiredDate: row.requiredDate,
      promisedDate: row.promisedDate,
      deliveryRowPresent: true,
      deliveryReceiptPromisedDate: deliveryRow.receiptPromisedDate
    });
    if (snapshotResult.sourceAvailability !== "Present") {
      candidates.push(
        impactCandidateWithState({
          targetType,
          targetId,
          sourceItemId,
          currentAffectedItems,
          persisted: persistedDecision,
          parent,
          item: null,
          snapshot: null,
          sourceAvailability: "Unavailable",
          unavailableReason: snapshotResult.reason,
          exposureClassification: null
        })
      );
      continue;
    }

    const snapshot = snapshotResult.snapshot as PurchaseOrderLineImpactSnapshot;
    const item: ChangeNoticeImpactItemContext = {
      id: snapshot.itemId,
      readableId: impactNullableString(impactValue(itemRow, "readableId")),
      readableIdWithRevision: impactNullableString(
        impactValue(itemRow, "readableIdWithRevision")
      ),
      revision: snapshot.itemRevision,
      unitOfMeasureCode: impactNullableString(
        impactValue(itemRow, "unitOfMeasureCode")
      )
    };
    const hasCurrentCause = currentAffectedItems.some(
      (affected) => affected.itemId === snapshot.itemId
    );
    const eligibility = classifyPurchaseOrderLineImpactEligibility({
      purchaseOrderLineType: snapshot.purchaseOrderLineType,
      purchaseOrderStatus: snapshot.purchaseOrderStatus,
      receivedComplete: snapshot.receivedComplete,
      remainingQuantity: snapshot.remainingQuantity,
      conversionFactor: snapshot.conversionFactor
    });
    const exposure = !hasCurrentCause
      ? "No longer in current scope"
      : eligibility === "Unavailable"
        ? null
        : eligibility;
    candidates.push(
      impactCandidateWithState({
        targetType,
        targetId,
        sourceItemId: snapshot.itemId,
        currentAffectedItems,
        persisted: persistedDecision,
        parent,
        item,
        snapshot,
        sourceAvailability: "Present",
        unavailableReason:
          eligibility === "Unavailable"
            ? "PO line eligibility facts are unavailable."
            : null,
        exposureClassification: exposure
      })
    );
  }

  const sourceSafeCandidates =
    impactCandidatesUnavailableWhenSourceCoverageFails(
      candidates,
      sourceCoverageError,
      "Purchasing source facts are unavailable."
    );
  const safeCandidates = impactCandidatesUnavailableWhenPersistedStateFails(
    sourceSafeCandidates,
    persisted.error
  );
  const hasUnavailableCandidate = safeCandidates.some(
    (candidate) =>
      candidate.sourceAvailability === "Unavailable" &&
      !persisted.byTarget.get(impactTargetKey(targetType, candidate.targetId))
        ?.snapshotIssue
  );
  const status: ChangeNoticeImpactCoverage["status"] = sourceFailed
    ? "failed"
    : summary.partial || persisted.partialTargetTypes.has(targetType)
      ? "partial"
      : hasUnavailableCandidate
        ? "failed"
        : "complete";
  const errorMessage =
    status === "failed"
      ? "Purchase Order Impact coverage failed."
      : status === "partial"
        ? "Purchase Order Impact coverage is partial."
        : undefined;
  safeCandidates.sort((left, right) =>
    compareImpactIds(left.targetId, right.targetId)
  );
  return {
    candidates: safeCandidates,
    coverage: impactCoverage(
      targetType,
      status,
      {
        current: currentRows.nextCursor,
        historical: historicalRows.nextCursor
      },
      safeCandidates,
      errorMessage,
      coverageSummary
    )
  };
}

async function discoverJobAndMaterialImpact(
  client: SupabaseClient<Database>,
  companyId: string,
  currentAffectedItems: Array<{
    id: string;
    itemId: string;
    label: string | null;
  }>,
  changeNoticeStatus: string,
  persisted: ImpactPersistedState,
  options: ResolvedImpactCandidateOptions
): Promise<{
  job: ImpactDomainDiscovery;
  jobMaterial: ImpactDomainDiscovery;
}> {
  const jobTargetType = "job" as const;
  const materialTargetType = "jobMaterial" as const;
  const productionAccess =
    options.sourceAccess.job && options.sourceAccess.jobMaterial;
  const jobAccess = productionAccess;
  const materialAccess = productionAccess;

  if (!jobAccess && !materialAccess) {
    return {
      job: {
        candidates: [],
        coverage: impactCoverage(
          jobTargetType,
          "restricted",
          null,
          [],
          "Production source access is restricted."
        )
      },
      jobMaterial: {
        candidates: [],
        coverage: impactCoverage(
          materialTargetType,
          "restricted",
          null,
          [],
          "Production source access is restricted."
        )
      }
    };
  }

  const currentItemIds =
    changeNoticeStatus === "Cancelled"
      ? []
      : [...new Set(currentAffectedItems.map((item) => item.itemId))];
  const classificationItemIds = [
    ...new Set(currentAffectedItems.map((item) => item.itemId))
  ];
  const persistedJobIds = [...persisted.byTarget.values()]
    .filter((decision) => decision.targetType === jobTargetType)
    .map((decision) => decision.targetId);
  const persistedMaterialIds = [...persisted.byTarget.values()]
    .filter((decision) => decision.targetType === materialTargetType)
    .map((decision) => decision.targetId);
  const [jobSummary, materialSummary] = await Promise.all([
    jobAccess
      ? readJobImpactSummary(
          client,
          companyId,
          currentItemIds,
          persistedJobIds,
          classificationItemIds
        )
      : Promise.resolve(emptyImpactCoverageSummary()),
    materialAccess
      ? readJobMaterialImpactSummary(
          client,
          companyId,
          currentItemIds,
          persistedMaterialIds,
          classificationItemIds
        )
      : Promise.resolve(emptyImpactCoverageSummary())
  ]);
  const jobCurrentRows: ImpactSourcePage = jobSummary.error
    ? await readJobCurrentRows(
        client,
        companyId,
        currentItemIds,
        impactFallbackOptions(options),
        false
      )
    : (() => {
        const page = impactPaginateRows(
          jobSummary.currentRows,
          impactCursor(options, jobTargetType, "current"),
          impactPageSize(options)
        );
        return { ...page, error: null };
      })();
  const materialCurrentRows: ImpactSourcePage = materialSummary.error
    ? await readJobMaterialCurrentRows(
        client,
        companyId,
        currentItemIds,
        impactFallbackOptions(options),
        false
      )
    : (() => {
        const page = impactPaginateRows(
          materialSummary.currentRows,
          impactCursor(options, materialTargetType, "current"),
          impactPageSize(options)
        );
        return { ...page, error: null };
      })();
  const persistedJobIdSet = new Set(persistedJobIds);
  const persistedMaterialIdSet = new Set(persistedMaterialIds);
  const [jobPersistedRows, materialPersistedRows] = await Promise.all([
    jobAccess && jobSummary.error
      ? readJobRowsByIds(client, companyId, persistedJobIds)
      : {
          rows: jobSummary.sourceRows.filter(
            (row) => typeof row.id === "string" && persistedJobIdSet.has(row.id)
          ),
          error: null
        },
    materialAccess && materialSummary.error
      ? readJobMaterialRowsByIds(client, companyId, persistedMaterialIds)
      : {
          rows: materialSummary.sourceRows.filter(
            (row) =>
              typeof row.id === "string" && persistedMaterialIdSet.has(row.id)
          ),
          error: null
        }
  ]);

  const jobScannedIds = new Set(
    jobSummary.sourceRows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : []
    )
  );
  const materialScannedIds = new Set(
    materialSummary.sourceRows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : []
    )
  );
  const jobHistoricalPlaceholders = persistedJobIds
    .filter((id) => !jobScannedIds.has(id))
    .map((id) => ({ id, __impactPlaceholder: true }));
  const materialHistoricalPlaceholders = persistedMaterialIds
    .filter((id) => !materialScannedIds.has(id))
    .map((id) => ({ id, __impactPlaceholder: true }));
  const jobCurrentSourceIds = new Set(
    jobSummary.currentRows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : []
    )
  );
  const materialCurrentSourceIds = new Set(
    materialSummary.currentRows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : []
    )
  );
  const persistedHistoricalJobs = jobPersistedRows.rows.filter(
    (row) => typeof row.id !== "string" || !jobCurrentSourceIds.has(row.id)
  );
  const persistedHistoricalMaterials = materialPersistedRows.rows.filter(
    (row) => typeof row.id !== "string" || !materialCurrentSourceIds.has(row.id)
  );
  const jobHistoricalPool = impactMergeRows(
    jobSummary.historicalRows,
    impactMergeRows(persistedHistoricalJobs, jobHistoricalPlaceholders)
  );
  const materialHistoricalPool = impactMergeRows(
    materialSummary.historicalRows,
    impactMergeRows(
      persistedHistoricalMaterials,
      materialHistoricalPlaceholders
    )
  );
  const jobHistoricalRows = impactPaginateRows(
    jobHistoricalPool,
    impactCursor(options, jobTargetType, "historical"),
    impactPageSize(options)
  );
  const materialHistoricalRows = impactPaginateRows(
    materialHistoricalPool,
    impactCursor(options, materialTargetType, "historical"),
    impactPageSize(options)
  );
  const jobTargetIds = [
    ...new Set([
      ...jobCurrentRows.rows.flatMap((row) =>
        typeof row.id === "string" ? [row.id] : []
      ),
      ...jobHistoricalRows.rows.flatMap((row) =>
        typeof row.id === "string" ? [row.id] : []
      )
    ])
  ];
  const materialTargetIds = [
    ...new Set([
      ...materialCurrentRows.rows.flatMap((row) =>
        typeof row.id === "string" ? [row.id] : []
      ),
      ...materialHistoricalRows.rows.flatMap((row) =>
        typeof row.id === "string" ? [row.id] : []
      )
    ])
  ];
  const selectedJobRows = jobPersistedRows.rows.filter((row) =>
    jobTargetIds.includes(row.id as string)
  );
  const selectedMaterialRows = materialPersistedRows.rows.filter((row) =>
    materialTargetIds.includes(row.id as string)
  );
  const materialRows = impactMergeRows(
    impactMergeRows(materialCurrentRows.rows, materialHistoricalRows.rows),
    selectedMaterialRows
  );
  const initialJobRows = impactMergeRows(
    impactMergeRows(jobCurrentRows.rows, jobHistoricalRows.rows),
    selectedJobRows
  );
  const initialJobById = impactMapRowsById(initialJobRows);
  const materialParentJobIds = materialRows.flatMap((row) =>
    typeof row.jobId === "string" ? [row.jobId] : []
  );
  const missingParentJobIds = materialParentJobIds.filter(
    (jobId) => !initialJobById.has(jobId)
  );
  const additionalParentJobs =
    materialAccess && missingParentJobIds.length > 0
      ? await readJobRowsByIds(client, companyId, missingParentJobIds)
      : { rows: [], error: null };
  const allJobRows = impactMergeRows(initialJobRows, additionalParentJobs.rows);
  const jobById = impactMapRowsById(allJobRows);
  const jobCoverageSummary = impactSummaryWithPersistedHistorical(
    jobSummary,
    persistedJobIds,
    jobSummary.sourceRows,
    !jobSummary.error && !jobSummary.partial
  );
  const materialCoverageSummary = impactSummaryWithPersistedHistorical(
    materialSummary,
    persistedMaterialIds,
    materialSummary.sourceRows,
    !materialSummary.error && !materialSummary.partial
  );
  const sourceJobIds = [
    ...new Set(
      jobTargetIds.concat(
        allJobRows
          .map((row) => row.id)
          .filter((id): id is string => typeof id === "string")
      )
    )
  ];
  const sourceItemIds = [
    ...new Set(
      allJobRows
        .concat(materialRows)
        .map((row) => row.itemId)
        .filter((id): id is string => typeof id === "string")
    )
  ];
  const [items, roots] = await Promise.all([
    jobAccess || materialAccess
      ? readImpactItems(client, companyId, sourceItemIds)
      : Promise.resolve({ rows: [], error: null }),
    jobAccess && sourceJobIds.length > 0
      ? readImpactJobRootMethods(client, companyId, sourceJobIds)
      : Promise.resolve({ rows: [], error: null })
  ]);
  const itemById = impactMapItems(items);
  const rootByJobId = new Map<string, ImpactRecord>();
  const duplicateRootJobs = new Set<string>();
  for (const root of roots.rows) {
    if (typeof root.jobId !== "string") continue;
    if (rootByJobId.has(root.jobId)) duplicateRootJobs.add(root.jobId);
    else rootByJobId.set(root.jobId, root);
  }

  const jobCandidates: ChangeNoticeImpactCandidate[] = [];
  if (jobAccess) {
    const jobSourceById = impactMapRowsById(
      jobCurrentRows.rows.concat(jobHistoricalRows.rows, selectedJobRows)
    );
    for (const targetId of jobTargetIds) {
      const persistedDecision = persisted.byTarget.get(
        impactTargetKey(jobTargetType, targetId)
      );
      const row = jobSourceById.get(targetId);
      if (!row || row.__impactPlaceholder === true) {
        const unavailable =
          jobCurrentRows.error ||
          jobPersistedRows.error ||
          jobSummary.error ||
          jobSummary.partial ||
          jobCoverageSummary.error ||
          persisted.error ||
          persisted.partialTargetTypes.has(jobTargetType)
            ? "Coverage is incomplete; source deletion cannot be established."
            : null;
        jobCandidates.push(
          impactCandidateWithState({
            targetType: jobTargetType,
            targetId,
            sourceItemId: null,
            currentAffectedItems,
            persisted: persistedDecision,
            parent: null,
            item: null,
            snapshot: null,
            sourceAvailability: unavailable ? "Unavailable" : "Source deleted",
            unavailableReason: unavailable,
            exposureClassification: unavailable ? null : "Historical reference"
          })
        );
        continue;
      }

      const sourceItemId = typeof row.itemId === "string" ? row.itemId : null;
      const itemRow = sourceItemId ? itemById.get(sourceItemId) : undefined;
      const root =
        typeof row.id === "string" ? rootByJobId.get(row.id) : undefined;
      const jobId = impactRequiredString(row.id, "job.id");
      const jobReadableId = impactRequiredString(row.jobId, "job.jobId");
      const rowStatus = impactRequiredString(row.status, "job.status");
      if (
        !jobId.ok ||
        !jobReadableId.ok ||
        !rowStatus.ok ||
        !itemRow ||
        !root ||
        (typeof row.id === "string" && duplicateRootJobs.has(row.id)) ||
        !impactJobRootMatchesItem(row, root)
      ) {
        jobCandidates.push(
          impactCandidateWithState({
            targetType: jobTargetType,
            targetId,
            sourceItemId,
            currentAffectedItems,
            persisted: persistedDecision,
            parent: null,
            item: null,
            snapshot: null,
            sourceAvailability: "Unavailable",
            unavailableReason:
              "Required Job, item, or root method facts are unavailable.",
            exposureClassification: null
          })
        );
        continue;
      }

      const snapshotResult = normalizeJobImpactSnapshot({
        jobId: row.id,
        itemId: row.itemId,
        itemRevision: itemRow.revision,
        status: rowStatus.value,
        plannedQuantity: row.quantity,
        quantityComplete: row.quantityComplete,
        quantityShipped: row.quantityShipped,
        quantityReceivedToInventory: row.quantityReceivedToInventory,
        dueDate: row.dueDate,
        effectiveMethodId: root.id,
        effectiveMethodVersion: root.version,
        unitOfMeasureCode: row.unitOfMeasureCode
      });
      if (snapshotResult.sourceAvailability !== "Present") {
        jobCandidates.push(
          impactCandidateWithState({
            targetType: jobTargetType,
            targetId,
            sourceItemId,
            currentAffectedItems,
            persisted: persistedDecision,
            parent: null,
            item: null,
            snapshot: null,
            sourceAvailability: "Unavailable",
            unavailableReason: snapshotResult.reason,
            exposureClassification: null
          })
        );
        continue;
      }

      const snapshot = snapshotResult.snapshot as JobImpactSnapshot;
      const item: ChangeNoticeImpactItemContext = {
        id: snapshot.itemId,
        readableId: impactNullableString(impactValue(itemRow, "readableId")),
        readableIdWithRevision: impactNullableString(
          impactValue(itemRow, "readableIdWithRevision")
        ),
        revision: snapshot.itemRevision,
        unitOfMeasureCode: impactNullableString(
          impactValue(itemRow, "unitOfMeasureCode")
        )
      };
      const parent: ChangeNoticeImpactParentContext = {
        type: "job",
        id: snapshot.jobId,
        readableId: jobReadableId.value,
        status: snapshot.status
      };
      const hasCurrentCause = currentAffectedItems.some(
        (affected) => affected.itemId === snapshot.itemId
      );
      const eligibility = classifyJobImpactEligibility(snapshot.status);
      jobCandidates.push(
        impactCandidateWithState({
          targetType: jobTargetType,
          targetId,
          sourceItemId: snapshot.itemId,
          currentAffectedItems,
          persisted: persistedDecision,
          parent,
          item,
          snapshot,
          sourceAvailability: "Present",
          unavailableReason: null,
          exposureClassification: !hasCurrentCause
            ? "No longer in current scope"
            : eligibility === "Unavailable"
              ? null
              : eligibility
        })
      );
    }
  }

  const materialCandidates: ChangeNoticeImpactCandidate[] = [];
  if (materialAccess) {
    const materialSourceById = impactMapRowsById(
      materialCurrentRows.rows.concat(
        materialHistoricalRows.rows,
        selectedMaterialRows
      )
    );
    for (const targetId of materialTargetIds) {
      const persistedDecision = persisted.byTarget.get(
        impactTargetKey(materialTargetType, targetId)
      );
      const row = materialSourceById.get(targetId);
      if (!row || row.__impactPlaceholder === true) {
        const unavailable =
          materialCurrentRows.error ||
          materialPersistedRows.error ||
          materialSummary.error ||
          materialSummary.partial ||
          materialCoverageSummary.error ||
          additionalParentJobs.error ||
          persisted.error ||
          persisted.partialTargetTypes.has(materialTargetType)
            ? "Coverage is incomplete; source deletion cannot be established."
            : null;
        materialCandidates.push(
          impactCandidateWithState({
            targetType: materialTargetType,
            targetId,
            sourceItemId: null,
            currentAffectedItems,
            persisted: persistedDecision,
            parent: null,
            item: null,
            snapshot: null,
            sourceAvailability: unavailable ? "Unavailable" : "Source deleted",
            unavailableReason: unavailable,
            exposureClassification: unavailable ? null : "Historical reference"
          })
        );
        continue;
      }

      const sourceItemId = typeof row.itemId === "string" ? row.itemId : null;
      const parentRow =
        typeof row.jobId === "string" ? jobById.get(row.jobId) : undefined;
      const itemRow = sourceItemId ? itemById.get(sourceItemId) : undefined;
      const parentId = impactRequiredString(row.jobId, "jobMaterial.jobId");
      const parentReadableId = parentRow
        ? impactRequiredString(parentRow.jobId, "job.jobId")
        : { ok: false as const, reason: "parent Job is unavailable" };
      const parentStatus = parentRow
        ? impactRequiredString(parentRow.status, "job.status")
        : { ok: false as const, reason: "parent Job is unavailable" };
      if (
        !parentId.ok ||
        !parentReadableId.ok ||
        !parentStatus.ok ||
        !itemRow
      ) {
        materialCandidates.push(
          impactCandidateWithState({
            targetType: materialTargetType,
            targetId,
            sourceItemId,
            currentAffectedItems,
            persisted: persistedDecision,
            parent: null,
            item: null,
            snapshot: null,
            sourceAvailability: "Unavailable",
            unavailableReason:
              "Required parent Job or item facts are unavailable.",
            exposureClassification: null
          })
        );
        continue;
      }

      const parent: ChangeNoticeImpactParentContext = {
        type: "job",
        id: parentId.value,
        readableId: parentReadableId.value,
        status: parentStatus.value
      };
      const snapshotResult = normalizeJobMaterialImpactSnapshot({
        jobMaterialId: row.id,
        jobId: row.jobId,
        itemId: row.itemId,
        itemRevision: itemRow.revision,
        jobStatus: parent.status,
        estimatedQuantity: row.estimatedQuantity,
        quantityIssued: row.quantityIssued,
        quantityToIssue: row.quantityToIssue,
        unitOfMeasureCode: row.unitOfMeasureCode,
        methodType: row.methodType,
        jobOperationId: row.jobOperationId,
        requiresBatchTracking: row.requiresBatchTracking,
        requiresSerialTracking: row.requiresSerialTracking
      });
      if (snapshotResult.sourceAvailability !== "Present") {
        materialCandidates.push(
          impactCandidateWithState({
            targetType: materialTargetType,
            targetId,
            sourceItemId,
            currentAffectedItems,
            persisted: persistedDecision,
            parent,
            item: null,
            snapshot: null,
            sourceAvailability: "Unavailable",
            unavailableReason: snapshotResult.reason,
            exposureClassification: null
          })
        );
        continue;
      }

      const snapshot = snapshotResult.snapshot as JobMaterialImpactSnapshot;
      const item: ChangeNoticeImpactItemContext = {
        id: snapshot.itemId,
        readableId: impactNullableString(impactValue(itemRow, "readableId")),
        readableIdWithRevision: impactNullableString(
          impactValue(itemRow, "readableIdWithRevision")
        ),
        revision: snapshot.itemRevision,
        unitOfMeasureCode: impactNullableString(
          impactValue(itemRow, "unitOfMeasureCode")
        )
      };
      const hasCurrentCause = currentAffectedItems.some(
        (affected) => affected.itemId === snapshot.itemId
      );
      const eligibility = classifyJobMaterialImpactEligibility(
        snapshot.jobStatus
      );
      materialCandidates.push(
        impactCandidateWithState({
          targetType: materialTargetType,
          targetId,
          sourceItemId: snapshot.itemId,
          currentAffectedItems,
          persisted: persistedDecision,
          parent,
          item,
          snapshot,
          sourceAvailability: "Present",
          unavailableReason: null,
          exposureClassification: !hasCurrentCause
            ? "No longer in current scope"
            : eligibility === "Unavailable"
              ? null
              : eligibility
        })
      );
    }
  }

  const jobSourceCoverageError =
    jobCurrentRows.error ??
    jobPersistedRows.error ??
    jobCoverageSummary.error ??
    (jobAccess ? items.error : null) ??
    roots.error;
  const materialSourceCoverageError =
    materialCurrentRows.error ??
    materialPersistedRows.error ??
    materialCoverageSummary.error ??
    (materialAccess ? items.error : null) ??
    additionalParentJobs.error;
  const jobFailed = !!jobSourceCoverageError || !!persisted.error;
  const materialFailed = !!materialSourceCoverageError || !!persisted.error;
  const sourceSafeJobCandidates =
    impactCandidatesUnavailableWhenSourceCoverageFails(
      jobCandidates,
      jobSourceCoverageError,
      "Production Job source facts are unavailable."
    );
  const sourceSafeMaterialCandidates =
    impactCandidatesUnavailableWhenSourceCoverageFails(
      materialCandidates,
      materialSourceCoverageError,
      "Job Material source facts are unavailable."
    );
  const safeJobCandidates = impactCandidatesUnavailableWhenPersistedStateFails(
    sourceSafeJobCandidates,
    persisted.error
  );
  const safeMaterialCandidates =
    impactCandidatesUnavailableWhenPersistedStateFails(
      sourceSafeMaterialCandidates,
      persisted.error
    );
  const hasUnavailableJobCandidate = safeJobCandidates.some(
    (candidate) =>
      candidate.sourceAvailability === "Unavailable" &&
      !persisted.byTarget.get(
        impactTargetKey(jobTargetType, candidate.targetId)
      )?.snapshotIssue
  );
  const hasUnavailableMaterialCandidate = safeMaterialCandidates.some(
    (candidate) =>
      candidate.sourceAvailability === "Unavailable" &&
      !persisted.byTarget.get(
        impactTargetKey(materialTargetType, candidate.targetId)
      )?.snapshotIssue
  );
  const jobStatus: ChangeNoticeImpactCoverage["status"] = jobFailed
    ? "failed"
    : jobSummary.partial || persisted.partialTargetTypes.has(jobTargetType)
      ? "partial"
      : hasUnavailableJobCandidate
        ? "failed"
        : "complete";
  const materialStatus: ChangeNoticeImpactCoverage["status"] = materialFailed
    ? "failed"
    : materialSummary.partial ||
        persisted.partialTargetTypes.has(materialTargetType)
      ? "partial"
      : hasUnavailableMaterialCandidate
        ? "failed"
        : "complete";
  safeJobCandidates.sort((left, right) =>
    compareImpactIds(left.targetId, right.targetId)
  );
  safeMaterialCandidates.sort((left, right) =>
    compareImpactIds(left.targetId, right.targetId)
  );
  return {
    job: jobAccess
      ? {
          candidates: safeJobCandidates,
          coverage: impactCoverage(
            jobTargetType,
            jobStatus,
            {
              current: jobCurrentRows.nextCursor,
              historical: jobHistoricalRows.nextCursor
            },
            safeJobCandidates,
            jobStatus === "failed"
              ? "Producing Job Impact coverage failed."
              : jobStatus === "partial"
                ? "Producing Job Impact coverage is partial."
                : undefined,
            jobCoverageSummary
          )
        }
      : {
          candidates: [],
          coverage: impactCoverage(
            jobTargetType,
            "restricted",
            null,
            [],
            "Production source access is restricted."
          )
        },
    jobMaterial: materialAccess
      ? {
          candidates: safeMaterialCandidates,
          coverage: impactCoverage(
            materialTargetType,
            materialStatus,
            {
              current: materialCurrentRows.nextCursor,
              historical: materialHistoricalRows.nextCursor
            },
            safeMaterialCandidates,
            materialStatus === "failed"
              ? "Job Material Impact coverage failed."
              : materialStatus === "partial"
                ? "Job Material Impact coverage is partial."
                : undefined,
            materialCoverageSummary
          )
        }
      : {
          candidates: [],
          coverage: impactCoverage(
            materialTargetType,
            "restricted",
            null,
            [],
            "Production source access is restricted."
          )
        }
  };
}

function isImpactSourceAccess(
  value: unknown
): value is ChangeNoticeImpactSourceAccess {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.hasOwn(record, "purchaseOrderLine") &&
    typeof record.purchaseOrderLine === "boolean" &&
    Object.hasOwn(record, "job") &&
    typeof record.job === "boolean" &&
    Object.hasOwn(record, "jobMaterial") &&
    typeof record.jobMaterial === "boolean"
  );
}

function isImpactSourceAccessResult(
  value: unknown
): value is ChangeNoticeImpactSourceAccessResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.status === "failed") {
    return typeof record.errorMessage === "string";
  }
  return record.status === "resolved" && isImpactSourceAccess(record.access);
}

function failedImpactCoverage(
  targetType: ChangeNoticeImpactTargetType
): ChangeNoticeImpactCoverage {
  return {
    targetType,
    status: "failed",
    currentExposureCount: null,
    historicalReferenceCount: null,
    unassessedCount: null,
    errorMessage: "Impact source access could not be established.",
    nextCursor: { current: null, historical: null }
  };
}

/**
 * Read-only supported-domain façade. The caller supplies source access already
 * derived from Carbon permissions; omitting a domain from access prevents all
 * source reads for that domain and returns a non-disclosing restricted result.
 */
export async function getChangeNoticeImpactCandidates(
  client: SupabaseClient<Database>,
  companyId: string,
  changeNoticeId: string,
  options: ChangeNoticeImpactCandidateOptions
): Promise<ChangeNoticeImpactCandidateReadResult> {
  // Access-resolution failure is not equivalent to three proven denials. Stop
  // before reading the Change Notice, persisted decisions, or any source table
  // so no target identity or copied evidence can escape on the failure path.
  const sourceAccessInput = options.sourceAccess;
  if (
    !isImpactSourceAccess(sourceAccessInput) &&
    !isImpactSourceAccessResult(sourceAccessInput)
  ) {
    return {
      data: {
        changeNoticeId,
        changeNoticeStatus: null,
        candidates: [],
        coverage: {
          purchaseOrderLine: failedImpactCoverage("purchaseOrderLine"),
          job: failedImpactCoverage("job"),
          jobMaterial: failedImpactCoverage("jobMaterial")
        }
      },
      error: null
    };
  }
  if (
    isImpactSourceAccessResult(sourceAccessInput) &&
    sourceAccessInput.status === "failed"
  ) {
    return {
      data: {
        changeNoticeId,
        changeNoticeStatus: null,
        candidates: [],
        coverage: {
          purchaseOrderLine: failedImpactCoverage("purchaseOrderLine"),
          job: failedImpactCoverage("job"),
          jobMaterial: failedImpactCoverage("jobMaterial")
        }
      },
      error: null
    };
  }

  const sourceAccess = isImpactSourceAccessResult(sourceAccessInput)
    ? sourceAccessInput.access
    : sourceAccessInput;
  const resolvedOptions: ResolvedImpactCandidateOptions = {
    ...options,
    sourceAccess
  };

  const changeNotice = await getChangeNotice(client, changeNoticeId, companyId);
  if (changeNotice.error || !changeNotice.data) {
    return {
      data: null,
      error: changeNotice.error ?? { message: "Change notice not found" }
    };
  }

  const affected = await getChangeNoticeAffectedItems(
    client,
    changeNoticeId,
    companyId
  );
  if (affected.error) {
    return { data: null, error: affected.error };
  }

  const currentAffectedItems = impactCurrentAffectedItems(
    affected.data.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      item: isImpactRecord(row.item) ? row.item : null
    }))
  );
  const persisted = await readImpactPersistedState(
    client,
    companyId,
    changeNoticeId,
    resolvedOptions
  );

  const [purchaseOrderLines, production] = await Promise.all([
    discoverPurchaseOrderLineImpact(
      client,
      companyId,
      currentAffectedItems,
      changeNotice.data.status,
      persisted,
      resolvedOptions
    ),
    discoverJobAndMaterialImpact(
      client,
      companyId,
      currentAffectedItems,
      changeNotice.data.status,
      persisted,
      resolvedOptions
    )
  ]);

  const candidateReadModel: ChangeNoticeImpactCandidateReadModel = {
    changeNoticeId,
    changeNoticeStatus: changeNotice.data.status,
    candidates: [
      ...purchaseOrderLines.candidates,
      ...production.job.candidates,
      ...production.jobMaterial.candidates
    ].sort((left, right) => {
      const typeOrder = left.targetType.localeCompare(right.targetType);
      return typeOrder !== 0
        ? typeOrder
        : compareImpactIds(left.targetId, right.targetId);
    }),
    coverage: {
      purchaseOrderLine: purchaseOrderLines.coverage,
      job: production.job.coverage,
      jobMaterial: production.jobMaterial.coverage
    }
  };

  return { data: candidateReadModel, error: null };
}

type ImpactTaskLinkRead = {
  links: ChangeNoticeImpactTaskLink[];
  coverage: ChangeNoticeImpactTaskCoverage;
};

async function readChangeNoticeImpactTaskLinks(
  client: SupabaseClient<Database>,
  companyId: string,
  changeNoticeId: string,
  decisionIds: string[]
): Promise<ImpactTaskLinkRead> {
  if (decisionIds.length === 0) {
    return {
      links: [],
      coverage: { status: "complete" }
    };
  }

  const linkRowsByBatch = await Promise.all(
    impactIdBatches(decisionIds).map((batch) =>
      fetchAllFromTable<ImpactRecord>(
        client,
        "changeOrderImpactDecisionActionTask",
        "decisionId, actionTaskId, companyId",
        (query) =>
          query
            .eq("companyId", companyId)
            .in("decisionId", batch)
            .order("decisionId", { ascending: true })
            .order("actionTaskId", { ascending: true })
      )
    )
  );
  const linkRowsError = linkRowsByBatch.find(
    (result) => result.error || !result.data
  );
  if (linkRowsError) {
    logger.error("Failed to read Change Notice Impact task links", {
      error: linkRowsError.error,
      companyId,
      changeNoticeId
    });
    return {
      links: [],
      coverage: {
        status: "failed",
        errorMessage: "Linked task coverage is unavailable."
      }
    };
  }

  const linkRows = linkRowsByBatch.flatMap((result) => result.data ?? []);
  const decisionIdSet = new Set(decisionIds);
  const parsedLinks = linkRows.flatMap((row) => {
    const decisionId = impactPersistedRequiredString(
      row.decisionId,
      "taskLink.decisionId"
    );
    const actionTaskId = impactPersistedRequiredString(
      row.actionTaskId,
      "taskLink.actionTaskId"
    );
    const rowCompanyId = impactPersistedRequiredString(
      row.companyId,
      "taskLink.companyId"
    );
    return decisionId.ok &&
      actionTaskId.ok &&
      rowCompanyId.ok &&
      rowCompanyId.value === companyId &&
      decisionIdSet.has(decisionId.value)
      ? [{ decisionId: decisionId.value, actionTaskId: actionTaskId.value }]
      : [];
  });
  const linkRowsMalformed = parsedLinks.length !== linkRows.length;
  const taskIds = [...new Set(parsedLinks.map((link) => link.actionTaskId))];
  if (taskIds.length === 0) {
    return {
      links: [],
      coverage: linkRowsMalformed
        ? {
            status: "partial",
            errorMessage: "Some linked task records are malformed."
          }
        : { status: "complete" }
    };
  }

  const taskRowsByBatch = await Promise.all(
    impactIdBatches(taskIds).map((batch) =>
      fetchAllFromTable<ImpactRecord>(
        client,
        "changeOrderActionTask",
        "id, changeOrderId, companyId, name, status, assignee, dueDate, taskOrigin",
        (query) =>
          query
            .eq("companyId", companyId)
            .eq("changeOrderId", changeNoticeId)
            .in("id", batch)
            .order("id", { ascending: true })
      )
    )
  );
  const taskRowsError = taskRowsByBatch.find(
    (result) => result.error || !result.data
  );
  if (taskRowsError) {
    logger.error("Failed to read linked Change Notice Impact tasks", {
      error: taskRowsError.error,
      companyId,
      changeNoticeId
    });
    return {
      links: [],
      coverage: {
        status: "failed",
        errorMessage: "Linked task coverage is unavailable."
      }
    };
  }

  const taskRows = taskRowsByBatch.flatMap((result) => result.data ?? []);
  const tasksById = new Map<string, ChangeNoticeImpactTaskLink>();
  let malformedTasks = false;
  for (const row of taskRows) {
    const id = impactPersistedRequiredString(row.id, "actionTask.id");
    const rowCompanyId = impactPersistedRequiredString(
      row.companyId,
      "actionTask.companyId"
    );
    const rowChangeNoticeId = impactPersistedRequiredString(
      row.changeOrderId,
      "actionTask.changeOrderId"
    );
    const status = row.status;
    if (
      !id.ok ||
      !rowCompanyId.ok ||
      rowCompanyId.value !== companyId ||
      !rowChangeNoticeId.ok ||
      rowChangeNoticeId.value !== changeNoticeId ||
      !impactIn(status, changeNoticeTaskStatus)
    ) {
      malformedTasks = true;
      continue;
    }
    tasksById.set(id.value, {
      decisionId: "",
      actionTaskId: id.value,
      name: impactNullableString(row.name),
      status,
      assignee: impactNullableString(row.assignee),
      dueDate: impactNullableString(row.dueDate),
      taskOrigin: impactNullableString(row.taskOrigin) ?? "Manual"
    });
  }

  const links: ChangeNoticeImpactTaskLink[] = [];
  let missingTasks = false;
  for (const link of parsedLinks) {
    const task = tasksById.get(link.actionTaskId);
    if (!task) {
      missingTasks = true;
      continue;
    }
    links.push({ ...task, decisionId: link.decisionId });
  }

  return {
    links,
    coverage:
      linkRowsMalformed || malformedTasks || missingTasks
        ? {
            status: "partial",
            errorMessage: "Some linked task records are unavailable."
          }
        : { status: "complete" }
  };
}

function projectImpactSnapshotForBrowser(
  snapshot: ChangeNoticeImpactSnapshot
): ChangeNoticeImpactWorkspaceSnapshot {
  if (snapshot.schema === PO_LINE_SNAPSHOT_V1) {
    return {
      schema: snapshot.schema,
      itemRevision: snapshot.itemRevision,
      purchaseOrderLineType: snapshot.purchaseOrderLineType,
      purchaseOrderStatus: snapshot.purchaseOrderStatus,
      receivedComplete: snapshot.receivedComplete,
      orderedQuantity: snapshot.orderedQuantity,
      receivedQuantity: snapshot.receivedQuantity,
      remainingQuantity: snapshot.remainingQuantity,
      purchaseUnitOfMeasureCode: snapshot.purchaseUnitOfMeasureCode,
      inventoryUnitOfMeasureCode: snapshot.inventoryUnitOfMeasureCode,
      conversionFactor: snapshot.conversionFactor,
      requiredDate: snapshot.requiredDate,
      promisedDate: snapshot.promisedDate,
      eligibilityBasis: snapshot.eligibilityBasis
    };
  }

  if (snapshot.schema === JOB_SNAPSHOT_V1) {
    return {
      schema: snapshot.schema,
      itemRevision: snapshot.itemRevision,
      status: snapshot.status,
      plannedQuantity: snapshot.plannedQuantity,
      completedQuantity: snapshot.completedQuantity,
      remainingQuantity: snapshot.remainingQuantity,
      quantityShipped: snapshot.quantityShipped,
      quantityReceivedToInventory: snapshot.quantityReceivedToInventory,
      dueDate: snapshot.dueDate,
      effectiveMethodVersion: snapshot.effectiveMethodVersion,
      unitOfMeasureCode: snapshot.unitOfMeasureCode,
      eligibilityBasis: snapshot.eligibilityBasis
    };
  }

  return {
    schema: snapshot.schema,
    itemRevision: snapshot.itemRevision,
    jobStatus: snapshot.jobStatus,
    requiredQuantity: snapshot.requiredQuantity,
    issuedQuantity: snapshot.issuedQuantity,
    remainingQuantity: snapshot.remainingQuantity,
    unitOfMeasureCode: snapshot.unitOfMeasureCode,
    methodType: snapshot.methodType,
    requiresTracking: snapshot.requiresTracking,
    eligibilityBasis: snapshot.eligibilityBasis
  };
}

function projectImpactDecisionForWorkspace(
  decision: ChangeNoticeImpactDecisionProjection
): ChangeNoticeImpactWorkspaceDecisionProjection {
  return {
    ...decision,
    persistedSnapshot: decision.persistedSnapshot
      ? projectImpactSnapshotForBrowser(decision.persistedSnapshot)
      : null
  };
}

function projectImpactCandidateForWorkspace(
  candidate: ChangeNoticeImpactCandidate,
  taskLinks: ChangeNoticeImpactTaskLink[],
  previewFingerprint: string | null
): ChangeNoticeImpactWorkspaceCandidate {
  return {
    ...candidate,
    currentSnapshot: candidate.currentSnapshot
      ? projectImpactSnapshotForBrowser(candidate.currentSnapshot)
      : null,
    decision: candidate.decision
      ? projectImpactDecisionForWorkspace(candidate.decision)
      : null,
    previewFingerprint,
    taskLinks
  };
}

/**
 * Read-only document workspace projection. Supported target discovery remains
 * delegated to the existing source-aware candidate façade; this layer only
 * adds the authorized task projection needed by the workspace rows. The
 * previously integrated Slice 3 task APIs/MCP adapters remain separate and are
 * not invoked or exposed as mutation controls by this projection.
 */
export async function getChangeNoticeImpactWorkspace(
  client: SupabaseClient<Database>,
  companyId: string,
  changeNoticeId: string,
  options: Pick<ChangeNoticeImpactCandidateOptions, "sourceAccess">
): Promise<ChangeNoticeImpactWorkspaceReadResult> {
  const candidatePage = await getChangeNoticeImpactCandidates(
    client,
    companyId,
    changeNoticeId,
    { sourceAccess: options.sourceAccess, fetchAll: true }
  );
  if (candidatePage.error || !candidatePage.data) {
    return {
      data: null,
      error: candidatePage.error ?? { message: "Impact workspace unavailable." }
    };
  }

  // The candidate façade owns target ordering and deduplication. For complete
  // coverage, a remaining cursor means this bounded workspace window was
  // exhausted, not that the source scan was complete. Failed/partial coverage
  // keeps its own status and message even if a bounded fallback has a cursor.
  const candidateReadModel = candidatePage.data;
  const candidates = candidateReadModel.candidates;
  const domainNames = ["purchaseOrderLine", "job", "jobMaterial"] as const;
  const coverage = Object.fromEntries(
    domainNames.map((targetType) => {
      const final = candidateReadModel.coverage[targetType];
      const pageLimitReached =
        final.status === "complete" &&
        (final.nextCursor.current !== null ||
          final.nextCursor.historical !== null);
      const resultStatus: ChangeNoticeImpactCoverage["status"] =
        pageLimitReached ? "partial" : final.status;
      return [
        targetType,
        {
          ...final,
          status: resultStatus,
          currentExposureCount:
            resultStatus === "complete" ? final.currentExposureCount : null,
          historicalReferenceCount:
            resultStatus === "complete" ? final.historicalReferenceCount : null,
          unassessedCount:
            resultStatus === "complete" ? final.unassessedCount : null,
          ...(pageLimitReached
            ? { errorMessage: "Impact workspace result limit reached." }
            : resultStatus !== "complete" && !final.errorMessage
              ? {
                  errorMessage:
                    resultStatus === "failed"
                      ? "Impact workspace coverage failed."
                      : resultStatus === "partial"
                        ? "Impact workspace coverage is partial."
                        : "Impact workspace source access is restricted."
                }
              : {})
        }
      ];
    })
  ) as ChangeNoticeImpactCandidateReadModel["coverage"];

  const decisionIds = [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.decision ? [candidate.decision.id] : []
      )
    )
  ];
  const taskRead = await readChangeNoticeImpactTaskLinks(
    client,
    companyId,
    changeNoticeId,
    decisionIds
  );
  const taskLinksByDecision = new Map<string, ChangeNoticeImpactTaskLink[]>();
  for (const link of taskRead.links) {
    const links = taskLinksByDecision.get(link.decisionId) ?? [];
    links.push(link);
    taskLinksByDecision.set(link.decisionId, links);
  }

  const workspaceCandidates: ChangeNoticeImpactWorkspaceCandidate[] =
    await Promise.all(
      candidates.map(async (candidate) =>
        projectImpactCandidateForWorkspace(
          candidate,
          candidate.decision
            ? (taskLinksByDecision.get(candidate.decision.id) ?? [])
            : [],
          candidate.currentSnapshot &&
            candidate.sourceAvailability === "Present" &&
            candidate.exposureClassification ===
              "Current operational exposure" &&
            candidate.currentProvenance[0]?.affectedItemId &&
            candidate.currentProvenance[0].affectedItemSourceId
            ? await createChangeNoticeImpactPreviewFingerprint({
                targetType: candidate.targetType,
                snapshot: candidate.currentSnapshot,
                affectedItemId: candidate.currentProvenance[0].affectedItemId,
                affectedItemSourceId:
                  candidate.currentProvenance[0].affectedItemSourceId
              })
            : null
        )
      )
    );

  const data: ChangeNoticeImpactWorkspaceReadModel = {
    changeNoticeId: candidateReadModel.changeNoticeId,
    changeNoticeStatus: candidateReadModel.changeNoticeStatus,
    candidates: workspaceCandidates,
    coverage,
    taskCoverage: taskRead.coverage
  };
  return { data, error: null };
}

type ImpactHistoryDecisionRow = Pick<
  Database["public"]["Tables"]["changeOrderImpactDecision"]["Row"],
  "id" | "companyId" | "changeNoticeId" | "targetType" | "targetId"
>;

type ImpactHistoryRow = Pick<
  Database["public"]["Tables"]["changeOrderImpactDecisionHistory"]["Row"],
  | "id"
  | "companyId"
  | "decisionId"
  | "targetType"
  | "targetId"
  | "eventType"
  | "previousStatus"
  | "newStatus"
  | "previousReasonCode"
  | "newReasonCode"
  | "previousSnapshot"
  | "newSnapshot"
  | "rationale"
  | "resolutionNote"
  | "relatedActionTaskId"
  | "relatedAffectedItemId"
  | "priorAssessmentWasChanged"
  | "createdBy"
  | "createdAt"
>;

type ImpactHistoryProvenanceRow = Pick<
  Database["public"]["Tables"]["changeOrderImpactDecisionAffectedItem"]["Row"],
  | "id"
  | "companyId"
  | "decisionId"
  | "affectedItemId"
  | "affectedItemLabel"
  | "startedAt"
  | "endedAt"
  | "endedReason"
>;

/**
 * Read one decision's independent Impact history. The decision lookup is the
 * request-boundary ownership check; history and provenance are then read with
 * the same tenant, decision, and stored target predicates so a guessed
 * decision id cannot widen the result.
 */
export async function getChangeNoticeImpactHistory(
  client: SupabaseClient<Database>,
  companyId: string,
  changeNoticeId: string,
  decisionId: string,
  options: Pick<ChangeNoticeImpactCandidateOptions, "sourceAccess">
): Promise<ChangeNoticeImpactHistoryReadResult> {
  const sourceAccessResult = options.sourceAccess;
  const sourceAccess =
    "status" in sourceAccessResult
      ? sourceAccessResult.status === "resolved"
        ? sourceAccessResult.access
        : null
      : sourceAccessResult;
  if (sourceAccess === null) {
    return {
      data: null,
      error: {
        kind: "unavailable",
        message: "Impact source access could not be established."
      }
    };
  }

  const decisionResult = await client
    .from("changeOrderImpactDecision")
    .select("id, companyId, changeNoticeId, targetType, targetId")
    .eq("companyId", companyId)
    .eq("changeNoticeId", changeNoticeId)
    .eq("id", decisionId)
    .maybeSingle();
  if (decisionResult.error) {
    logger.error("Failed to read Change Notice Impact history decision", {
      error: decisionResult.error,
      companyId,
      changeNoticeId,
      decisionId
    });
    return {
      data: null,
      error: {
        kind: "unavailable",
        message: "Impact history could not be loaded."
      }
    };
  }
  if (!decisionResult.data) {
    return {
      data: null,
      error: {
        kind: "not-found",
        message: "Impact decision was not found."
      }
    };
  }

  const decision = decisionResult.data as ImpactHistoryDecisionRow;
  if (
    !changeNoticeImpactTargetTypes.includes(
      decision.targetType as ChangeNoticeImpactTargetType
    ) ||
    decision.targetId.length === 0 ||
    !impactSourceAccessAllows(
      decision.targetType as ChangeNoticeImpactTargetType,
      sourceAccess
    )
  ) {
    return {
      data: null,
      error: {
        kind: "restricted",
        message: "Impact history is restricted for this target."
      }
    };
  }

  const targetType = decision.targetType as ChangeNoticeImpactTargetType;
  const historyResult = await fetchAllFromTable<ImpactHistoryRow>(
    client,
    "changeOrderImpactDecisionHistory",
    "id, companyId, decisionId, targetType, targetId, eventType, previousStatus, newStatus, previousReasonCode, newReasonCode, previousSnapshot, newSnapshot, rationale, resolutionNote, relatedActionTaskId, relatedAffectedItemId, priorAssessmentWasChanged, createdBy, createdAt",
    (query) =>
      query
        .eq("companyId", companyId)
        .eq("decisionId", decision.id)
        .eq("targetType", targetType)
        .eq("targetId", decision.targetId)
        .order("createdAt", { ascending: false })
        .order("id", { ascending: false })
  );
  if (historyResult.error || !historyResult.data) {
    logger.error("Failed to read Change Notice Impact history", {
      error: historyResult.error,
      companyId,
      changeNoticeId,
      decisionId
    });
    return {
      data: null,
      error: {
        kind: "unavailable",
        message: "Impact history could not be loaded."
      }
    };
  }

  const malformedHistory = historyResult.data.some(
    (row) =>
      row.companyId !== companyId ||
      row.decisionId !== decision.id ||
      row.targetType !== targetType ||
      row.targetId !== decision.targetId ||
      row.id.length === 0 ||
      row.eventType.length === 0 ||
      row.createdBy.length === 0 ||
      row.createdAt.length === 0
  );
  if (malformedHistory) {
    logger.error("Malformed Change Notice Impact history row", {
      companyId,
      changeNoticeId,
      decisionId
    });
    return {
      data: null,
      error: {
        kind: "unavailable",
        message: "Impact history could not be loaded."
      }
    };
  }

  const entriesWithSource = historyResult.data.map((row) => ({
    row,
    entry: {
      id: row.id,
      eventType: row.eventType,
      previousStatus: impactHistoryStatus(row.previousStatus),
      newStatus: impactHistoryStatus(row.newStatus),
      previousReasonCode: impactHistoryReasonCode(row.previousReasonCode),
      newReasonCode: impactHistoryReasonCode(row.newReasonCode),
      previousSnapshot: projectImpactHistorySnapshot(
        targetType,
        decision.targetId,
        row.previousSnapshot
      ),
      previousSnapshotStatus: impactHistorySnapshotStatus(
        targetType,
        decision.targetId,
        row.previousSnapshot
      ),
      newSnapshot: projectImpactHistorySnapshot(
        targetType,
        decision.targetId,
        row.newSnapshot
      ),
      newSnapshotStatus: impactHistorySnapshotStatus(
        targetType,
        decision.targetId,
        row.newSnapshot
      ),
      rationale: impactHistoryText(row.rationale),
      resolutionNote: impactHistoryText(row.resolutionNote),
      priorAssessmentWasChanged: row.priorAssessmentWasChanged === true,
      relatedActionTaskId: impactHistoryText(row.relatedActionTaskId),
      provenance: null as ChangeNoticeImpactHistoryProvenance | null,
      createdBy: row.createdBy,
      createdAt: row.createdAt
    } satisfies ChangeNoticeImpactHistoryEntry
  }));

  const relatedAffectedItemIds = [
    ...new Set(
      entriesWithSource.flatMap(({ row }) =>
        row.relatedAffectedItemId ? [row.relatedAffectedItemId] : []
      )
    )
  ];
  if (relatedAffectedItemIds.length === 0) {
    return {
      data: { entries: entriesWithSource.map(({ entry }) => entry) },
      error: null
    };
  }

  const provenanceResult = await fetchAllFromTable<ImpactHistoryProvenanceRow>(
    client,
    "changeOrderImpactDecisionAffectedItem",
    "id, companyId, decisionId, affectedItemId, affectedItemLabel, startedAt, endedAt, endedReason",
    (query) =>
      query
        .eq("companyId", companyId)
        .eq("decisionId", decision.id)
        .in("affectedItemId", relatedAffectedItemIds)
        .order("startedAt", { ascending: false })
        .order("id", { ascending: false })
  );
  if (provenanceResult.error || !provenanceResult.data) {
    logger.error("Failed to read Change Notice Impact history provenance", {
      error: provenanceResult.error,
      companyId,
      changeNoticeId,
      decisionId
    });
    return {
      data: null,
      error: {
        kind: "unavailable",
        message: "Impact history could not be loaded."
      }
    };
  }

  const provenanceByAffectedItem = new Map<
    string,
    ImpactHistoryProvenanceRow[]
  >();
  for (const row of provenanceResult.data) {
    if (
      row.companyId !== companyId ||
      row.decisionId !== decision.id ||
      row.affectedItemId.length === 0
    ) {
      continue;
    }
    const rows = provenanceByAffectedItem.get(row.affectedItemId) ?? [];
    rows.push(row);
    provenanceByAffectedItem.set(row.affectedItemId, rows);
  }

  for (const { row, entry } of entriesWithSource) {
    if (!row.relatedAffectedItemId) continue;
    entry.provenance = resolveImpactHistoryProvenance(
      provenanceByAffectedItem.get(row.relatedAffectedItemId) ?? [],
      row.eventType,
      row.createdAt
    );
  }

  return {
    data: { entries: entriesWithSource.map(({ entry }) => entry) },
    error: null
  };
}

function impactHistoryText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function impactHistoryStatus(
  value: unknown
): ChangeNoticeImpactDecisionStatus | null {
  return typeof value === "string" &&
    (changeNoticeImpactDecisionStatuses as readonly string[]).includes(value)
    ? (value as ChangeNoticeImpactDecisionStatus)
    : null;
}

function impactHistoryReasonCode(
  value: unknown
): ChangeNoticeImpactNoActionReasonCode | null {
  return typeof value === "string" &&
    (changeNoticeImpactNoActionReasonCodes as readonly string[]).includes(value)
    ? (value as ChangeNoticeImpactNoActionReasonCode)
    : null;
}

function projectImpactHistorySnapshot(
  targetType: ChangeNoticeImpactTargetType,
  targetId: string,
  value: unknown
): ChangeNoticeImpactWorkspaceSnapshot | null {
  if (
    !isCanonicalStoredImpactSnapshot(targetType, value) ||
    !snapshotIdentityMatches(targetType, value, targetId)
  ) {
    return null;
  }
  return projectImpactSnapshotForBrowser(value);
}

function impactHistorySnapshotStatus(
  targetType: ChangeNoticeImpactTargetType,
  targetId: string,
  value: unknown
): ChangeNoticeImpactHistorySnapshotStatus {
  if (value === null) return "absent";
  return isCanonicalStoredImpactSnapshot(targetType, value) &&
    snapshotIdentityMatches(targetType, value, targetId)
    ? "present"
    : "unavailable";
}

function resolveImpactHistoryProvenance(
  rows: ImpactHistoryProvenanceRow[],
  eventType: string,
  createdAt: string
): ChangeNoticeImpactHistoryProvenance | null {
  if (rows.length === 0) return null;
  const isEndedEvent = eventType === "Provenance ended";
  const relevantRows = rows.filter((row) =>
    isEndedEvent ? row.endedAt !== null : row.startedAt.length > 0
  );
  const matchingRow = relevantRows.find((row) =>
    isEndedEvent ? row.endedAt === createdAt : row.startedAt === createdAt
  );
  const row = matchingRow ?? relevantRows[0] ?? rows[0];
  return {
    affectedItemLabel: row.affectedItemLabel,
    endedAt: row.endedAt,
    endedReason: row.endedReason
  };
}

const IMPACT_TARGET_UNIQUE_CONSTRAINT = "changeOrderImpactDecision_target_key";
const IMPACT_FIRST_ASSESSMENT_CONFLICT_MESSAGE =
  "This Impact target was assessed by someone else. Refresh and reassess.";
const IMPACT_REVISION_CONFLICT_MESSAGE =
  "This Impact assessment changed before your update. Refresh and try again.";
const IMPACT_NO_ACTION_RESOLUTION_INVALID_MESSAGE =
  "No action required decisions cannot transition directly to Resolved.";
const IMPACT_PROVENANCE_CHANGED_REASON =
  "Affected item provenance changed before reassessment";

type ImpactFirstAssessmentEvidence = {
  affectedItemId: string;
  affectedItemSourceId: string;
  affectedItemLabel: string;
  snapshot: ChangeNoticeImpactSnapshot;
};

type ImpactDecisionWriteFailure = {
  data: null;
  error: { message: string };
};

function impactMutationFailure(message: string): ImpactDecisionWriteFailure {
  return { data: null, error: { message } };
}

function impactMutationErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Impact assessment failed.";
}

type ImpactExistingDecision = {
  id: string;
  targetType: string;
  targetId: string;
  decisionStatus: string;
  noActionReasonCode: string | null;
  rationale: string | null;
  resolutionNote: string | null;
  assessmentSnapshot: unknown;
  snapshotVersion: number;
  assessedBy: string;
  assessedAt: string;
  revision: number;
};

type ImpactPersistedProvenanceRow = {
  id: string;
  affectedItemId: string;
  affectedItemSourceId: string;
  affectedItemLabel: string | null;
  startedAt: string;
  startedBy: string;
  endedAt: string | null;
  endedBy: string | null;
  endedReason: string | null;
};

type ImpactDecisionValues = {
  decisionStatus: ChangeNoticeImpactDecisionStatus;
  noActionReasonCode:
    | (typeof changeNoticeImpactNoActionReasonCodes)[number]
    | null;
  rationale: string | null;
  resolutionNote: string | null;
};

function impactTrimmedNullableText(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function impactStoredNullableText(value: unknown): string | null {
  return typeof value === "string" ? impactTrimmedNullableText(value) : null;
}

function impactExistingDecisionValues(
  decision: ImpactExistingDecision
): ImpactDecisionValues {
  return {
    decisionStatus: decision.decisionStatus as ChangeNoticeImpactDecisionStatus,
    noActionReasonCode: impactIn(
      decision.noActionReasonCode,
      changeNoticeImpactNoActionReasonCodes
    )
      ? decision.noActionReasonCode
      : null,
    rationale: impactStoredNullableText(decision.rationale),
    resolutionNote: impactStoredNullableText(decision.resolutionNote)
  };
}

function impactHistoryEventForOperation(
  operation: Exclude<
    ChangeNoticeImpactDecisionOperation,
    "createDecision" | "noOp" | "resolveActionRequired"
  >
): string {
  switch (operation) {
    case "reassessDecision":
      return "Decision reassessed";
    case "correctDecision":
      return "Conclusion corrected";
    case "reopenDecision":
      return "Decision reopened";
    case "updateDecision":
      return "Decision reassessed";
  }
}

function impactDecisionHistoryRow(input: {
  companyId: string;
  decisionId: string;
  targetType: ChangeNoticeImpactTargetType;
  targetId: string;
  eventType: string;
  previous: ImpactDecisionValues;
  next: ImpactDecisionValues;
  previousSnapshot: Json | null;
  newSnapshot: Json | null;
  rationale: string | null;
  resolutionNote: string | null;
  priorAssessmentWasChanged: boolean;
  createdBy: string;
  createdAt: string;
  relatedAffectedItemId?: string;
}): Database["public"]["Tables"]["changeOrderImpactDecisionHistory"]["Insert"] {
  return {
    companyId: input.companyId,
    decisionId: input.decisionId,
    targetType: input.targetType,
    targetId: input.targetId,
    eventType: input.eventType,
    previousStatus: input.previous.decisionStatus,
    newStatus: input.next.decisionStatus,
    previousReasonCode: input.previous.noActionReasonCode,
    newReasonCode: input.next.noActionReasonCode,
    previousSnapshot: input.previousSnapshot,
    newSnapshot: input.newSnapshot,
    rationale: input.rationale,
    resolutionNote: input.resolutionNote,
    ...(input.relatedAffectedItemId
      ? { relatedAffectedItemId: input.relatedAffectedItemId }
      : {}),
    priorAssessmentWasChanged: input.priorAssessmentWasChanged,
    createdBy: input.createdBy,
    createdAt: input.createdAt
  };
}

function isImpactTargetUniqueConflict(cause: unknown): boolean {
  if (!isImpactRecord(cause)) return false;
  return (
    cause.code === "23505" &&
    (cause.constraint === IMPACT_TARGET_UNIQUE_CONSTRAINT ||
      (typeof cause.detail === "string" &&
        cause.detail.includes(IMPACT_TARGET_UNIQUE_CONSTRAINT)))
  );
}

function impactSourceAccessAllows(
  targetType: ChangeNoticeImpactTargetType,
  sourceAccess: ChangeNoticeImpactDecisionMutationInput["sourceAccess"]
): boolean {
  if (!isImpactRecord(sourceAccess)) return false;
  if (
    typeof sourceAccess.purchaseOrderLine !== "boolean" ||
    typeof sourceAccess.job !== "boolean" ||
    typeof sourceAccess.jobMaterial !== "boolean"
  ) {
    return false;
  }
  return targetType === "purchaseOrderLine"
    ? sourceAccess.purchaseOrderLine
    : targetType === "job"
      ? sourceAccess.job
      : sourceAccess.jobMaterial;
}

function impactHistoricalItemLabel(item: {
  readableIdWithRevision: string | null;
  readableId: string;
  name: string;
}): string {
  return item.readableIdWithRevision ?? item.readableId ?? item.name;
}

/**
 * Keep one current affected-item cause for an existing decision. The source row
 * has one scalar item reference, so a changed current cause closes the old
 * interval before opening the new one. All interval and history writes remain
 * inside the caller's transaction.
 */
async function reconcileImpactDecisionProvenance(
  trx: KyselyTx,
  input: ChangeNoticeImpactDecisionMutationInput,
  existing: ImpactExistingDecision,
  previousValues: ImpactDecisionValues,
  nextValues: ImpactDecisionValues,
  evidence: ImpactFirstAssessmentEvidence,
  previousSnapshot: Json,
  newSnapshot: Json,
  priorAssessmentWasChanged: boolean,
  now: string,
  rows: ImpactPersistedProvenanceRow[]
): Promise<{
  changed: boolean;
  historyRows: Database["public"]["Tables"]["changeOrderImpactDecisionHistory"]["Insert"][];
}> {
  const openRows = rows.filter(
    (row) => row.endedAt === null || row.endedAt === undefined
  );
  if (openRows.length > 1) {
    throw new ImpactMutationRejected(
      "Impact decision has more than one current provenance cause."
    );
  }

  const open = openRows[0];
  if (
    open &&
    open.affectedItemId === evidence.affectedItemId &&
    open.affectedItemSourceId === evidence.affectedItemSourceId
  ) {
    return { changed: false, historyRows: [] };
  }

  const historyRows: Database["public"]["Tables"]["changeOrderImpactDecisionHistory"]["Insert"][] =
    [];
  if (open) {
    await trx
      .updateTable("changeOrderImpactDecisionAffectedItem")
      .set({
        endedAt: now,
        endedBy: input.userId,
        endedReason: IMPACT_PROVENANCE_CHANGED_REASON,
        updatedAt: now,
        updatedBy: input.userId
      })
      .where("id", "=", open.id)
      .where("companyId", "=", input.companyId)
      .where("decisionId", "=", existing.id)
      .where("endedAt", "is", null)
      .execute();

    historyRows.push(
      impactDecisionHistoryRow({
        companyId: input.companyId,
        decisionId: existing.id,
        targetType: input.targetType,
        targetId: input.targetId,
        eventType: "Provenance ended",
        previous: previousValues,
        next: nextValues,
        previousSnapshot,
        newSnapshot,
        rationale: IMPACT_PROVENANCE_CHANGED_REASON,
        resolutionNote: nextValues.resolutionNote,
        priorAssessmentWasChanged,
        relatedAffectedItemId: open.affectedItemId,
        createdBy: input.userId,
        createdAt: now
      })
    );
  }

  await trx
    .insertInto("changeOrderImpactDecisionAffectedItem")
    .values({
      companyId: input.companyId,
      decisionId: existing.id,
      affectedItemId: evidence.affectedItemId,
      affectedItemSourceId: evidence.affectedItemSourceId,
      affectedItemLabel: evidence.affectedItemLabel,
      startedAt: now,
      startedBy: input.userId,
      createdBy: input.userId,
      createdAt: now
    })
    .execute();

  historyRows.push(
    impactDecisionHistoryRow({
      companyId: input.companyId,
      decisionId: existing.id,
      targetType: input.targetType,
      targetId: input.targetId,
      eventType: "Provenance started",
      previous: previousValues,
      next: nextValues,
      previousSnapshot,
      newSnapshot,
      rationale: "Affected item provenance started during reassessment",
      resolutionNote: nextValues.resolutionNote,
      priorAssessmentWasChanged,
      relatedAffectedItemId: evidence.affectedItemId,
      createdBy: input.userId,
      createdAt: now
    })
  );

  return { changed: true, historyRows };
}

/**
 * Validate the server-owned fields shared by single and bulk Impact decision
 * mutation boundaries before a transaction starts.
 */
function validateImpactDecisionMutationInput(
  input: unknown
): ImpactDecisionWriteFailure | null {
  if (!isImpactRecord(input)) {
    return impactMutationFailure("Impact assessment input is invalid.");
  }
  const inputRecord = input as Record<string, unknown>;
  const mutation = input as unknown as ChangeNoticeImpactDecisionMutationInput;

  if (
    [
      "operation",
      "eventType",
      "assessmentSnapshot",
      "snapshot",
      "effectivityProof",
      "purchasingInterventionConfirmation"
    ].some((key) => Object.prototype.hasOwnProperty.call(inputRecord, key))
  ) {
    return impactMutationFailure(
      "Impact operation, event type, and assessment snapshot are server-derived."
    );
  }
  if (
    typeof mutation.companyId !== "string" ||
    mutation.companyId.length === 0 ||
    typeof mutation.userId !== "string" ||
    mutation.userId.length === 0 ||
    typeof mutation.changeNoticeId !== "string" ||
    mutation.changeNoticeId.length === 0 ||
    typeof mutation.targetId !== "string" ||
    mutation.targetId.length === 0
  ) {
    return impactMutationFailure("Impact assessment identity is required.");
  }
  if (!impactIn(mutation.targetType, changeNoticeImpactTargetTypes)) {
    return impactMutationFailure("Impact target type is unsupported.");
  }
  if (!impactIn(mutation.decisionStatus, changeNoticeImpactDecisionStatuses)) {
    return impactMutationFailure("Impact decision status is unsupported.");
  }
  if (!impactSourceAccessAllows(mutation.targetType, mutation.sourceAccess)) {
    return impactMutationFailure(
      "Impact source access is restricted for this target."
    );
  }

  const reason = mutation.noActionReasonCode ?? null;
  if (
    reason !== null &&
    !impactIn(reason, changeNoticeImpactNoActionReasonCodes)
  ) {
    return impactMutationFailure("Impact No Action reason is unsupported.");
  }
  if (
    mutation.rationale !== undefined &&
    mutation.rationale !== null &&
    typeof mutation.rationale !== "string"
  ) {
    return impactMutationFailure("Impact rationale must be text or null.");
  }
  if (
    mutation.resolutionNote !== undefined &&
    mutation.resolutionNote !== null &&
    typeof mutation.resolutionNote !== "string"
  ) {
    return impactMutationFailure(
      "Impact resolution note must be text or null."
    );
  }
  if (
    mutation.confirmNoPurchasingInterventionRemains !== undefined &&
    typeof mutation.confirmNoPurchasingInterventionRemains !== "boolean"
  ) {
    return impactMutationFailure(
      "Impact purchasing intervention confirmation must be boolean."
    );
  }
  if (
    mutation.expectedRevision !== undefined &&
    mutation.expectedRevision !== null &&
    (!Number.isInteger(mutation.expectedRevision) ||
      mutation.expectedRevision <= 0)
  ) {
    return impactMutationFailure("Expected decision revision is invalid.");
  }
  if (
    mutation.expectedSnapshotFingerprint !== undefined &&
    (typeof mutation.expectedSnapshotFingerprint !== "string" ||
      mutation.expectedSnapshotFingerprint.trim().length === 0)
  ) {
    return impactMutationFailure("Impact preview fingerprint is invalid.");
  }

  return null;
}

type ImpactMutationBulkValidation =
  | {
      input: ChangeNoticeImpactDecisionBulkMutationInput;
      decisions: ChangeNoticeImpactDecisionMutationInput[];
    }
  | { error: ImpactDecisionWriteFailure };

const IMPACT_BULK_INPUT_KEYS = new Set([
  "companyId",
  "userId",
  "sourceAccess",
  "changeNoticeId",
  "targets"
]);
const IMPACT_BULK_TARGET_KEYS = new Set([
  "targetType",
  "targetId",
  "decisionStatus",
  "noActionReasonCode",
  "rationale",
  "resolutionNote",
  "confirmNoPurchasingInterventionRemains",
  "expectedRevision",
  "expectedSnapshotFingerprint"
]);

function validateImpactDecisionBulkMutationInput(
  input: unknown
): ImpactMutationBulkValidation {
  if (!isImpactRecord(input)) {
    return {
      error: impactMutationFailure("Impact bulk assessment input is invalid.")
    };
  }
  const bulk = input as unknown as ChangeNoticeImpactDecisionBulkMutationInput;
  if (Object.keys(input).some((key) => !IMPACT_BULK_INPUT_KEYS.has(key))) {
    return {
      error: impactMutationFailure(
        "Impact bulk input contains unsupported fields."
      )
    };
  }
  if (
    [
      "operation",
      "eventType",
      "assessmentSnapshot",
      "snapshot",
      "effectivityProof",
      "purchasingInterventionConfirmation"
    ].some((key) => Object.prototype.hasOwnProperty.call(input, key))
  ) {
    return {
      error: impactMutationFailure(
        "Impact operation, event type, and assessment snapshot are server-derived."
      )
    };
  }
  if (
    typeof bulk.companyId !== "string" ||
    bulk.companyId.length === 0 ||
    typeof bulk.userId !== "string" ||
    bulk.userId.length === 0 ||
    typeof bulk.changeNoticeId !== "string" ||
    bulk.changeNoticeId.length === 0
  ) {
    return {
      error: impactMutationFailure(
        "Impact bulk assessment identity is required."
      )
    };
  }
  if (!Array.isArray(bulk.targets) || bulk.targets.length === 0) {
    return {
      error: impactMutationFailure("At least one Impact target is required.")
    };
  }

  const decisions: ChangeNoticeImpactDecisionMutationInput[] = [];
  const seen = new Set<string>();
  for (const target of bulk.targets) {
    if (!isImpactRecord(target)) {
      return {
        error: impactMutationFailure("Impact bulk target input is invalid.")
      };
    }
    if (Object.keys(target).some((key) => !IMPACT_BULK_TARGET_KEYS.has(key))) {
      return {
        error: impactMutationFailure(
          "Impact bulk targets must contain only decision fields."
        )
      };
    }

    const decision = {
      ...target,
      companyId: bulk.companyId,
      userId: bulk.userId,
      changeNoticeId: bulk.changeNoticeId,
      sourceAccess: bulk.sourceAccess
    } as unknown as ChangeNoticeImpactDecisionMutationInput;
    const validation = validateImpactDecisionMutationInput(decision);
    if (validation) return { error: validation };

    const key = impactTargetKey(decision.targetType, decision.targetId);
    if (seen.has(key)) {
      return {
        error: impactMutationFailure(
          `Bulk Impact targets must be unique: ${decision.targetType}/${decision.targetId}.`
        )
      };
    }
    seen.add(key);
    decisions.push(decision);
  }

  return { input: bulk, decisions };
}

type ImpactMutationChangeNotice = {
  id: string;
  companyId: string;
  status: Database["public"]["Enums"]["changeOrderStatus"];
};

type ImpactExistingDecisionRow = ImpactExistingDecision & {
  companyId?: string;
  changeNoticeId?: string;
};

async function loadImpactMutationChangeNotice(
  trx: KyselyTx,
  input: ChangeNoticeImpactDecisionMutationInput
): Promise<ImpactMutationChangeNotice> {
  const changeNotice = await trx
    .selectFrom("changeOrder")
    .select(["id", "companyId", "status"])
    .where("id", "=", input.changeNoticeId)
    .where("companyId", "=", input.companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!changeNotice) {
    throw new ImpactMutationRejected("Change notice not found.");
  }
  return changeNotice;
}

async function loadImpactMutationExistingDecisions(
  trx: KyselyTx,
  inputs: ChangeNoticeImpactDecisionMutationInput[]
): Promise<Map<string, ImpactExistingDecision>> {
  const byTarget = new Map<string, ImpactExistingDecision>();
  const decisionIds = new Set<string>();
  const requested = new Set(
    inputs.map((input) => impactTargetKey(input.targetType, input.targetId))
  );

  for (const targetType of changeNoticeImpactTargetTypes) {
    const targetIds = inputs
      .filter((input) => input.targetType === targetType)
      .map((input) => input.targetId)
      .sort();
    for (const batch of impactIdBatches(targetIds)) {
      const rows = (await trx
        .selectFrom("changeOrderImpactDecision")
        .select([
          "id",
          "companyId",
          "changeNoticeId",
          "targetType",
          "targetId",
          "decisionStatus",
          "noActionReasonCode",
          "rationale",
          "resolutionNote",
          "assessmentSnapshot",
          "snapshotVersion",
          "assessedBy",
          sql<string>`"assessedAt"::text`.as("assessedAt"),
          "revision"
        ])
        .where("companyId", "=", inputs[0].companyId)
        .where("changeNoticeId", "=", inputs[0].changeNoticeId)
        .where("targetType", "=", targetType)
        .where("targetId", "in", batch)
        .orderBy("targetId", "asc")
        .forUpdate()
        .execute()) as unknown as ImpactExistingDecisionRow[];

      for (const row of rows) {
        if (
          typeof row.id !== "string" ||
          typeof row.targetType !== "string" ||
          typeof row.targetId !== "string"
        ) {
          throw new ImpactMutationRejected(
            "Stored Impact decision identity is inconsistent."
          );
        }
        const rowKey = impactTargetKey(row.targetType, row.targetId);
        if (
          !requested.has(rowKey) ||
          (row.companyId !== undefined &&
            row.companyId !== inputs[0].companyId) ||
          (row.changeNoticeId !== undefined &&
            row.changeNoticeId !== inputs[0].changeNoticeId)
        ) {
          throw new ImpactMutationRejected(
            "Stored Impact decision identity is inconsistent."
          );
        }
        if (byTarget.has(rowKey) || decisionIds.has(row.id)) {
          throw new ImpactMutationRejected(
            "Stored Impact decisions contain a duplicate identity."
          );
        }
        decisionIds.add(row.id);
        byTarget.set(rowKey, row);
      }
    }
  }

  return byTarget;
}

type ImpactMutationBatchedReader<T> = (batch: string[]) => Promise<T[]>;

async function readImpactMutationBatches<T>(
  ids: string[],
  readBatch: ImpactMutationBatchedReader<T>,
  description: string,
  idOf: (row: T) => unknown,
  companyOf: (row: T) => unknown,
  companyId: string
): Promise<T[]> {
  const requested = new Set(ids);
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const batch of impactIdBatches([...new Set(ids)].sort())) {
    const batchRows = await readBatch(batch);
    for (const row of batchRows) {
      const id = idOf(row);
      if (
        typeof id !== "string" ||
        !requested.has(id) ||
        seen.has(id) ||
        companyOf(row) !== companyId
      ) {
        throw new ImpactMutationRejected(description);
      }
      seen.add(id);
      rows.push(row);
    }
  }
  return rows;
}

type ImpactPurchaseOrderLineMutationRow = Pick<
  Database["public"]["Tables"]["purchaseOrderLine"]["Row"],
  | "id"
  | "companyId"
  | "purchaseOrderId"
  | "itemId"
  | "purchaseOrderLineType"
  | "purchaseQuantity"
  | "quantityReceived"
  | "quantityToReceive"
  | "receivedComplete"
  | "purchaseUnitOfMeasureCode"
  | "inventoryUnitOfMeasureCode"
  | "conversionFactor"
  | "requiredDate"
  | "promisedDate"
>;

type ImpactPurchaseOrderMutationRow = Pick<
  Database["public"]["Tables"]["purchaseOrder"]["Row"],
  "id" | "companyId" | "supplierId" | "status"
>;

type ImpactPurchaseOrderDeliveryMutationRow = Pick<
  Database["public"]["Tables"]["purchaseOrderDelivery"]["Row"],
  "id" | "companyId" | "receiptPromisedDate"
>;

type ImpactItemMutationRow = Pick<
  Database["public"]["Tables"]["item"]["Row"],
  | "id"
  | "companyId"
  | "readableId"
  | "readableIdWithRevision"
  | "name"
  | "revision"
>;

type ImpactJobMutationRow = Pick<
  Database["public"]["Tables"]["job"]["Row"],
  | "id"
  | "companyId"
  | "itemId"
  | "jobId"
  | "status"
  | "quantity"
  | "quantityComplete"
  | "quantityShipped"
  | "quantityReceivedToInventory"
  | "dueDate"
  | "unitOfMeasureCode"
>;

type ImpactJobMaterialMutationRow = Pick<
  Database["public"]["Tables"]["jobMaterial"]["Row"],
  | "id"
  | "companyId"
  | "jobId"
  | "itemId"
  | "estimatedQuantity"
  | "quantityIssued"
  | "quantityToIssue"
  | "unitOfMeasureCode"
  | "methodType"
  | "jobOperationId"
  | "requiresBatchTracking"
  | "requiresSerialTracking"
>;

type ImpactJobRootMutationRow = Pick<
  Database["public"]["Tables"]["jobMakeMethod"]["Row"],
  "id" | "companyId" | "jobId" | "itemId" | "version"
>;

async function readImpactMutationPurchaseOrderLines(
  trx: KyselyTx,
  companyId: string,
  ids: string[]
): Promise<ImpactPurchaseOrderLineMutationRow[]> {
  return readImpactMutationBatches(
    ids,
    (batch) =>
      trx
        .selectFrom("purchaseOrderLine")
        .select([
          "id",
          "companyId",
          "purchaseOrderId",
          "itemId",
          "purchaseOrderLineType",
          "purchaseQuantity",
          "quantityReceived",
          "quantityToReceive",
          "receivedComplete",
          "purchaseUnitOfMeasureCode",
          "inventoryUnitOfMeasureCode",
          "conversionFactor",
          sql<string | null>`"requiredDate"::text`.as("requiredDate"),
          sql<string | null>`"promisedDate"::text`.as("promisedDate")
        ])
        .where("companyId", "=", companyId)
        .where("id", "in", batch)
        .orderBy("id", "asc")
        .execute(),
    "Complete purchaseOrderLine source evidence is unavailable.",
    (row) => row.id,
    (row) => row.companyId,
    companyId
  );
}

async function readImpactMutationPurchaseOrders(
  trx: KyselyTx,
  companyId: string,
  ids: string[]
): Promise<ImpactPurchaseOrderMutationRow[]> {
  return readImpactMutationBatches(
    ids,
    (batch) =>
      trx
        .selectFrom("purchaseOrder")
        .select(["id", "companyId", "supplierId", "status"])
        .where("companyId", "=", companyId)
        .where("id", "in", batch)
        .orderBy("id", "asc")
        .execute(),
    "Complete purchase-order parent facts are unavailable.",
    (row) => row.id,
    (row) => row.companyId,
    companyId
  );
}

async function readImpactMutationPurchaseOrderDeliveries(
  trx: KyselyTx,
  companyId: string,
  ids: string[]
): Promise<ImpactPurchaseOrderDeliveryMutationRow[]> {
  return readImpactMutationBatches(
    ids,
    (batch) =>
      trx
        .selectFrom("purchaseOrderDelivery")
        .select([
          "id",
          "companyId",
          sql<string | null>`"receiptPromisedDate"::text`.as(
            "receiptPromisedDate"
          )
        ])
        .where("companyId", "=", companyId)
        .where("id", "in", batch)
        .orderBy("id", "asc")
        .execute(),
    "Complete purchase-order delivery facts are unavailable.",
    (row) => row.id,
    (row) => row.companyId,
    companyId
  );
}

async function readImpactMutationItems(
  trx: KyselyTx,
  companyId: string,
  ids: string[]
): Promise<ImpactItemMutationRow[]> {
  return readImpactMutationBatches(
    ids,
    (batch) =>
      trx
        .selectFrom("item")
        .select([
          "id",
          "companyId",
          "readableId",
          "readableIdWithRevision",
          "name",
          "revision"
        ])
        .where("companyId", "=", companyId)
        .where("id", "in", batch)
        .orderBy("id", "asc")
        .execute(),
    "Complete item facts are unavailable.",
    (row) => row.id,
    (row) => row.companyId,
    companyId
  );
}

async function readImpactMutationJobs(
  trx: KyselyTx,
  companyId: string,
  ids: string[]
): Promise<ImpactJobMutationRow[]> {
  return readImpactMutationBatches(
    ids,
    (batch) =>
      trx
        .selectFrom("job")
        .select([
          "id",
          "companyId",
          "itemId",
          "jobId",
          "status",
          "quantity",
          "quantityComplete",
          "quantityShipped",
          "quantityReceivedToInventory",
          sql<string | null>`"dueDate"::text`.as("dueDate"),
          "unitOfMeasureCode"
        ])
        .where("companyId", "=", companyId)
        .where("id", "in", batch)
        .orderBy("id", "asc")
        .execute(),
    "Complete Job source evidence is unavailable.",
    (row) => row.id,
    (row) => row.companyId,
    companyId
  );
}

async function readImpactMutationJobMaterials(
  trx: KyselyTx,
  companyId: string,
  ids: string[]
): Promise<ImpactJobMaterialMutationRow[]> {
  return readImpactMutationBatches(
    ids,
    (batch) =>
      trx
        .selectFrom("jobMaterial")
        .select([
          "id",
          "companyId",
          "jobId",
          "itemId",
          "estimatedQuantity",
          "quantityIssued",
          "quantityToIssue",
          "unitOfMeasureCode",
          "methodType",
          "jobOperationId",
          "requiresBatchTracking",
          "requiresSerialTracking"
        ])
        .where("companyId", "=", companyId)
        .where("id", "in", batch)
        .orderBy("id", "asc")
        .execute(),
    "Complete Job Material source evidence is unavailable.",
    (row) => row.id,
    (row) => row.companyId,
    companyId
  );
}

async function readImpactMutationJobRoots(
  trx: KyselyTx,
  companyId: string,
  jobIds: string[]
): Promise<ImpactJobRootMutationRow[]> {
  const requested = new Set(jobIds);
  const seenIds = new Set<string>();
  const rows: ImpactJobRootMutationRow[] = [];
  for (const batch of impactIdBatches([...new Set(jobIds)].sort())) {
    const batchRows = await trx
      .selectFrom("jobMakeMethod")
      .select(["id", "companyId", "jobId", "itemId", "version"])
      .where("companyId", "=", companyId)
      .where("jobId", "in", batch)
      .where("parentMaterialId", "is", null)
      .orderBy("jobId", "asc")
      .orderBy("id", "asc")
      .execute();
    for (const row of batchRows) {
      if (
        !requested.has(row.jobId) ||
        seenIds.has(row.id) ||
        row.companyId !== companyId
      ) {
        throw new ImpactMutationRejected(
          "Complete, trustworthy Job method coverage is unavailable."
        );
      }
      seenIds.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

type ImpactMutationEvidenceSeed = {
  input: ChangeNoticeImpactDecisionMutationInput;
  sourceItemId: string;
  affectedItemLabel: string;
  snapshot: ChangeNoticeImpactSnapshot;
};

async function loadImpactMutationPurchaseOrderLineEvidence(
  trx: KyselyTx,
  input: ChangeNoticeImpactDecisionMutationInput[]
): Promise<ImpactMutationEvidenceSeed[]> {
  if (input.length === 0) return [];
  const companyId = input[0].companyId;
  const sourceRows = await readImpactMutationPurchaseOrderLines(
    trx,
    companyId,
    input.map((item) => item.targetId)
  );
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const missing = input.find((item) => !sourceById.has(item.targetId));
  if (missing) throw new ImpactMutationRejected("Impact target not found.");

  const parentIds = sourceRows.map((row) => row.purchaseOrderId);
  const parents = await readImpactMutationPurchaseOrders(
    trx,
    companyId,
    parentIds
  );
  const parentById = new Map(parents.map((row) => [row.id, row]));
  const deliveries = await readImpactMutationPurchaseOrderDeliveries(
    trx,
    companyId,
    parentIds
  );
  const deliveryById = new Map(deliveries.map((row) => [row.id, row]));
  const sourceItemIds = sourceRows.flatMap((row) =>
    row.itemId ? [row.itemId] : []
  );
  const items = await readImpactMutationItems(trx, companyId, sourceItemIds);
  const itemById = new Map(items.map((row) => [row.id, row]));

  return input.map((item) => {
    const line = sourceById.get(item.targetId);
    if (!line) throw new ImpactMutationRejected("Impact target not found.");
    if (!line.itemId) {
      throw new ImpactMutationRejected(
        "Required purchase-order item facts are unavailable."
      );
    }
    const parent = parentById.get(line.purchaseOrderId);
    if (!parent) {
      throw new ImpactMutationRejected(
        "Required purchase-order parent facts are unavailable."
      );
    }
    const delivery = deliveryById.get(parent.id);
    if (!delivery) {
      throw new ImpactMutationRejected(
        "Required purchase-order delivery facts are unavailable."
      );
    }
    const itemFacts = itemById.get(line.itemId);
    if (!itemFacts) {
      throw new ImpactMutationRejected("Required item facts are unavailable.");
    }
    const normalized = normalizePurchaseOrderLineImpactSnapshot({
      purchaseOrderLineId: line.id,
      purchaseOrderId: line.purchaseOrderId,
      supplierId: parent.supplierId,
      itemId: line.itemId,
      itemRevision: itemFacts.revision,
      purchaseOrderLineType: line.purchaseOrderLineType,
      purchaseOrderStatus: parent.status,
      receivedComplete: line.receivedComplete,
      purchaseQuantity: line.purchaseQuantity,
      quantityReceived: line.quantityReceived,
      quantityToReceive: line.quantityToReceive,
      purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
      inventoryUnitOfMeasureCode: line.inventoryUnitOfMeasureCode,
      conversionFactor: line.conversionFactor,
      requiredDate: line.requiredDate,
      promisedDate: line.promisedDate,
      deliveryRowPresent: true,
      deliveryReceiptPromisedDate: delivery.receiptPromisedDate
    });
    if (normalized.sourceAvailability !== "Present") {
      throw new ImpactMutationRejected(normalized.reason);
    }
    const snapshot = normalized.snapshot as PurchaseOrderLineImpactSnapshot;
    const eligibility = classifyPurchaseOrderLineImpactEligibility({
      purchaseOrderLineType: snapshot.purchaseOrderLineType,
      purchaseOrderStatus: snapshot.purchaseOrderStatus,
      receivedComplete: snapshot.receivedComplete,
      remainingQuantity: snapshot.remainingQuantity,
      conversionFactor: snapshot.conversionFactor
    });
    if (eligibility !== "Current operational exposure") {
      throw new ImpactMutationRejected(
        "Impact target is not a current operational exposure."
      );
    }
    return {
      input: item,
      sourceItemId: line.itemId,
      affectedItemLabel: impactHistoricalItemLabel(itemFacts),
      snapshot
    };
  });
}

async function loadImpactMutationJobEvidence(
  trx: KyselyTx,
  input: ChangeNoticeImpactDecisionMutationInput[]
): Promise<ImpactMutationEvidenceSeed[]> {
  if (input.length === 0) return [];
  const companyId = input[0].companyId;
  const sourceRows = await readImpactMutationJobs(
    trx,
    companyId,
    input.map((item) => item.targetId)
  );
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const missing = input.find((item) => !sourceById.has(item.targetId));
  if (missing) throw new ImpactMutationRejected("Impact target not found.");

  const items = await readImpactMutationItems(
    trx,
    companyId,
    sourceRows.map((row) => row.itemId)
  );
  const itemById = new Map(items.map((row) => [row.id, row]));
  const roots = await readImpactMutationJobRoots(
    trx,
    companyId,
    sourceRows.map((row) => row.id)
  );
  const rootsByJobId = new Map<string, ImpactJobRootMutationRow>();
  const duplicateRootJobIds = new Set<string>();
  for (const root of roots) {
    if (rootsByJobId.has(root.jobId)) duplicateRootJobIds.add(root.jobId);
    else rootsByJobId.set(root.jobId, root);
  }

  return input.map((item) => {
    const job = sourceById.get(item.targetId);
    if (!job) throw new ImpactMutationRejected("Impact target not found.");
    const itemFacts = itemById.get(job.itemId);
    const root = rootsByJobId.get(job.id);
    if (
      !itemFacts ||
      !root ||
      duplicateRootJobIds.has(job.id) ||
      root.itemId !== job.itemId
    ) {
      throw new ImpactMutationRejected(
        "Complete, trustworthy Job method coverage is unavailable."
      );
    }
    const normalized = normalizeJobImpactSnapshot({
      jobId: job.id,
      itemId: job.itemId,
      itemRevision: itemFacts.revision,
      status: job.status,
      plannedQuantity: job.quantity,
      quantityComplete: job.quantityComplete,
      quantityShipped: job.quantityShipped,
      quantityReceivedToInventory: job.quantityReceivedToInventory,
      dueDate: job.dueDate,
      effectiveMethodId: root.id,
      effectiveMethodVersion: root.version,
      unitOfMeasureCode: job.unitOfMeasureCode
    });
    if (normalized.sourceAvailability !== "Present") {
      throw new ImpactMutationRejected(normalized.reason);
    }
    const snapshot = normalized.snapshot as JobImpactSnapshot;
    if (
      classifyJobImpactEligibility(snapshot.status) !==
      "Current operational exposure"
    ) {
      throw new ImpactMutationRejected(
        "Impact target is not a current operational exposure."
      );
    }
    return {
      input: item,
      sourceItemId: job.itemId,
      affectedItemLabel: impactHistoricalItemLabel(itemFacts),
      snapshot
    };
  });
}

async function loadImpactMutationJobMaterialEvidence(
  trx: KyselyTx,
  input: ChangeNoticeImpactDecisionMutationInput[]
): Promise<ImpactMutationEvidenceSeed[]> {
  if (input.length === 0) return [];
  const companyId = input[0].companyId;
  const sourceRows = await readImpactMutationJobMaterials(
    trx,
    companyId,
    input.map((item) => item.targetId)
  );
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const missing = input.find((item) => !sourceById.has(item.targetId));
  if (missing) throw new ImpactMutationRejected("Impact target not found.");

  const parents = await readImpactMutationJobs(
    trx,
    companyId,
    sourceRows.map((row) => row.jobId)
  );
  const parentById = new Map(parents.map((row) => [row.id, row]));
  const items = await readImpactMutationItems(
    trx,
    companyId,
    sourceRows.map((row) => row.itemId)
  );
  const itemById = new Map(items.map((row) => [row.id, row]));

  return input.map((item) => {
    const material = sourceById.get(item.targetId);
    if (!material) throw new ImpactMutationRejected("Impact target not found.");
    const parent = parentById.get(material.jobId);
    const itemFacts = itemById.get(material.itemId);
    if (!parent) {
      throw new ImpactMutationRejected(
        "Required parent Job facts are unavailable."
      );
    }
    if (!itemFacts) {
      throw new ImpactMutationRejected("Required item facts are unavailable.");
    }
    const normalized = normalizeJobMaterialImpactSnapshot({
      jobMaterialId: material.id,
      jobId: material.jobId,
      itemId: material.itemId,
      itemRevision: itemFacts.revision,
      jobStatus: parent.status,
      estimatedQuantity: material.estimatedQuantity,
      quantityIssued: material.quantityIssued,
      quantityToIssue: material.quantityToIssue,
      unitOfMeasureCode: material.unitOfMeasureCode,
      methodType: material.methodType,
      jobOperationId: material.jobOperationId,
      requiresBatchTracking: material.requiresBatchTracking,
      requiresSerialTracking: material.requiresSerialTracking
    });
    if (normalized.sourceAvailability !== "Present") {
      throw new ImpactMutationRejected(normalized.reason);
    }
    const snapshot = normalized.snapshot as JobMaterialImpactSnapshot;
    if (
      classifyJobMaterialImpactEligibility(snapshot.jobStatus) !==
      "Current operational exposure"
    ) {
      throw new ImpactMutationRejected(
        "Impact target is not a current operational exposure."
      );
    }
    return {
      input: item,
      sourceItemId: material.itemId,
      affectedItemLabel: impactHistoricalItemLabel(itemFacts),
      snapshot
    };
  });
}

async function attachImpactMutationAffectedItems(
  trx: KyselyTx,
  companyId: string,
  changeNoticeId: string,
  seeds: ImpactMutationEvidenceSeed[]
): Promise<Map<string, ImpactFirstAssessmentEvidence>> {
  if (seeds.length === 0) return new Map();
  const itemIds = [...new Set(seeds.map((seed) => seed.sourceItemId))].sort();
  const affectedRows: Array<{
    id: string;
    companyId: string;
    changeOrderId: string;
    itemId: string;
  }> = [];
  for (const batch of impactIdBatches(itemIds)) {
    const rows = await trx
      .selectFrom("changeOrderAffectedItem")
      .select(["id", "companyId", "changeOrderId", "itemId"])
      .where("companyId", "=", companyId)
      .where("changeOrderId", "=", changeNoticeId)
      .where("itemId", "in", batch)
      .orderBy("itemId", "asc")
      .orderBy("id", "asc")
      .forUpdate()
      .execute();
    affectedRows.push(...rows);
  }
  const affectedByItemId = new Map<string, { id: string; itemId: string }>();
  for (const row of affectedRows) {
    if (
      typeof row.id !== "string" ||
      typeof row.itemId !== "string" ||
      row.companyId !== companyId ||
      row.changeOrderId !== changeNoticeId ||
      affectedByItemId.has(row.itemId)
    ) {
      throw new ImpactMutationRejected(
        "Change Notice has more than one current affected-item cause."
      );
    }
    affectedByItemId.set(row.itemId, { id: row.id, itemId: row.itemId });
  }

  const evidenceByTarget = new Map<string, ImpactFirstAssessmentEvidence>();
  for (const seed of seeds) {
    const affected = affectedByItemId.get(seed.sourceItemId);
    if (!affected) {
      throw new ImpactMutationRejected(
        "Impact target is no longer in the current Change Notice scope."
      );
    }
    evidenceByTarget.set(
      impactTargetKey(seed.input.targetType, seed.input.targetId),
      {
        affectedItemId: affected.id,
        affectedItemSourceId: seed.sourceItemId,
        affectedItemLabel: seed.affectedItemLabel,
        snapshot: seed.snapshot
      }
    );
  }
  return evidenceByTarget;
}

async function loadImpactMutationEvidence(
  trx: KyselyTx,
  inputs: ChangeNoticeImpactDecisionMutationInput[]
): Promise<Map<string, ImpactFirstAssessmentEvidence>> {
  if (inputs.length === 0) return new Map();
  const purchaseOrderLineInputs = inputs.filter(
    (input) => input.targetType === "purchaseOrderLine"
  );
  const jobInputs = inputs.filter((input) => input.targetType === "job");
  const jobMaterialInputs = inputs.filter(
    (input) => input.targetType === "jobMaterial"
  );
  const seeds = [
    ...(await loadImpactMutationPurchaseOrderLineEvidence(
      trx,
      purchaseOrderLineInputs
    )),
    ...(await loadImpactMutationJobEvidence(trx, jobInputs)),
    ...(await loadImpactMutationJobMaterialEvidence(trx, jobMaterialInputs))
  ];
  return attachImpactMutationAffectedItems(
    trx,
    inputs[0].companyId,
    inputs[0].changeNoticeId,
    seeds
  );
}

async function loadImpactMutationProvenance(
  trx: KyselyTx,
  companyId: string,
  decisionIds: string[]
): Promise<Map<string, ImpactPersistedProvenanceRow[]>> {
  const byDecision = new Map<string, ImpactPersistedProvenanceRow[]>();
  const requested = new Set(decisionIds);
  const seenIds = new Set<string>();
  for (const batch of impactIdBatches([...new Set(decisionIds)].sort())) {
    const rows = (await trx
      .selectFrom("changeOrderImpactDecisionAffectedItem")
      .select([
        "id",
        "companyId",
        "decisionId",
        "affectedItemId",
        "affectedItemSourceId",
        "affectedItemLabel",
        "startedAt",
        "startedBy",
        "endedAt",
        "endedBy",
        "endedReason"
      ])
      .where("companyId", "=", companyId)
      .where("decisionId", "in", batch)
      .orderBy("decisionId", "asc")
      .orderBy("startedAt", "asc")
      .orderBy("id", "asc")
      .forUpdate()
      .execute()) as unknown as ImpactPersistedProvenanceRow[];
    for (const row of rows) {
      const decisionId = (
        row as ImpactPersistedProvenanceRow & { decisionId?: unknown }
      ).decisionId;
      const rowCompanyId = (
        row as ImpactPersistedProvenanceRow & { companyId?: unknown }
      ).companyId;
      if (
        typeof row.id !== "string" ||
        typeof decisionId !== "string" ||
        typeof row.affectedItemId !== "string" ||
        typeof row.affectedItemSourceId !== "string" ||
        !requested.has(decisionId) ||
        seenIds.has(row.id) ||
        (rowCompanyId !== undefined && rowCompanyId !== companyId)
      ) {
        throw new ImpactMutationRejected(
          "Stored Impact provenance identity is inconsistent."
        );
      }
      seenIds.add(row.id);
      const rowsForDecision = byDecision.get(decisionId) ?? [];
      rowsForDecision.push(row);
      byDecision.set(decisionId, rowsForDecision);
    }
  }
  return byDecision;
}

type ImpactDecisionPreflight = {
  input: ChangeNoticeImpactDecisionMutationInput;
  operation: ChangeNoticeImpactDecisionOperation;
  existing: ImpactExistingDecision | null;
  previousValues: ImpactDecisionValues | null;
  nextValues: ImpactDecisionValues;
  previousSnapshot: Json | null;
  requiresEvidence: boolean;
};

type ImpactDecisionPlan = ImpactDecisionPreflight & {
  evidence: ImpactFirstAssessmentEvidence | null;
  newSnapshot: Json | null;
  priorAssessmentWasChanged: boolean;
  decisionValuesChanged: boolean;
  provenanceRows: ImpactPersistedProvenanceRow[];
  provenanceChanged: boolean;
};

const IMPACT_RESOLUTION_TASK_NOT_TERMINAL_MESSAGE =
  "All linked Impact tasks must be Completed or Skipped before resolution.";

/**
 * Lock resolution prerequisites in the same order used by the other Impact
 * mutation paths: the Change Notice and decision are already locked by the
 * caller, then task rows, then relationship rows. The initial relationship
 * read is intentionally unlocked so no relationship row is locked before its
 * task row; the Change Notice lock serializes supported link/unlink writers.
 */
async function lockAndValidateImpactResolutionTasks(
  trx: KyselyTx,
  input: ChangeNoticeImpactDecisionMutationInput,
  decisionId: string
): Promise<void> {
  const linkRows = await trx
    .selectFrom("changeOrderImpactDecisionActionTask")
    .select(["decisionId", "actionTaskId", "companyId"])
    .where("decisionId", "=", decisionId)
    .where("companyId", "=", input.companyId)
    .orderBy("actionTaskId", "asc")
    .execute();

  for (const row of linkRows) {
    if (
      row.decisionId !== decisionId ||
      row.companyId !== input.companyId ||
      typeof row.actionTaskId !== "string" ||
      row.actionTaskId.length === 0
    ) {
      throw new ImpactMutationRejected(
        "Stored Impact task link is inconsistent."
      );
    }
  }
  const taskIds = linkRows.map((row) => row.actionTaskId);
  if (new Set(taskIds).size !== taskIds.length) {
    throw new ImpactMutationRejected(
      "Stored Impact task links contain a duplicate task identity."
    );
  }

  // Zero linked tasks is valid. There is no task row to lock in that case,
  // while the Change Notice row lock still prevents supported concurrent links.
  const tasks =
    taskIds.length === 0
      ? []
      : await trx
          .selectFrom("changeOrderActionTask")
          .select(["id", "companyId", "changeOrderId", "status"])
          .where("id", "in", taskIds)
          .where("companyId", "=", input.companyId)
          .where("changeOrderId", "=", input.changeNoticeId)
          .orderBy("id", "asc")
          .forUpdate()
          .execute();

  if (tasks.length !== taskIds.length) {
    throw new ImpactMutationRejected(
      "A linked Impact task is unavailable for resolution."
    );
  }
  for (const task of tasks) {
    if (
      task.companyId !== input.companyId ||
      task.changeOrderId !== input.changeNoticeId ||
      typeof task.id !== "string" ||
      task.id.length === 0
    ) {
      throw new ImpactMutationRejected(
        "Stored Impact task identity is inconsistent."
      );
    }
    if (task.status !== "Completed" && task.status !== "Skipped") {
      throw new ImpactMutationRejected(
        IMPACT_RESOLUTION_TASK_NOT_TERMINAL_MESSAGE
      );
    }
  }

  if (taskIds.length === 0) return;

  // Lock relationship rows only after all referenced task rows are locked and
  // verify that the link set did not change while the prerequisite set was
  // being read.
  const lockedLinks = await trx
    .selectFrom("changeOrderImpactDecisionActionTask")
    .select(["decisionId", "actionTaskId", "companyId"])
    .where("decisionId", "=", decisionId)
    .where("companyId", "=", input.companyId)
    .orderBy("actionTaskId", "asc")
    .forUpdate()
    .execute();
  for (const row of lockedLinks) {
    if (
      row.decisionId !== decisionId ||
      row.companyId !== input.companyId ||
      typeof row.actionTaskId !== "string" ||
      row.actionTaskId.length === 0
    ) {
      throw new ImpactMutationRejected(
        "Stored Impact task link is inconsistent."
      );
    }
  }
  if (
    lockedLinks.length !== linkRows.length ||
    lockedLinks.some((row, index) => row.actionTaskId !== taskIds[index])
  ) {
    throw new ImpactMutationRejected(
      "Impact task links changed while resolution was being prepared."
    );
  }
}

/**
 * Classify one requested conclusion without reading source evidence. Existing
 * Action Required resolution is intentionally the decision-only path: its
 * persisted canonical snapshot and authorized closure note are sufficient, so
 * current source and provenance reads are not required. Every other create or
 * reassessment plan is completed with authoritative evidence below.
 */
function planImpactDecisionWithoutEvidence(
  input: ChangeNoticeImpactDecisionMutationInput,
  changeNotice: ImpactMutationChangeNotice,
  existing: ImpactExistingDecision | undefined,
  allowDoneFirstAssessment = false
): ImpactDecisionPreflight {
  const existingStatus =
    existing &&
    impactIn(existing.decisionStatus, changeNoticeImpactDecisionStatuses)
      ? (existing.decisionStatus as ChangeNoticeImpactDecisionStatus)
      : null;
  if (existing && existingStatus === null) {
    throw new ImpactMutationRejected(
      "Stored Impact decision has an unsupported status."
    );
  }

  const operation = deriveChangeNoticeImpactDecisionOperation({
    existingStatus,
    requestedStatus: input.decisionStatus
  });

  if (!existing) {
    const firstAssessmentAllowed =
      changeNoticeStageFlow.includes(changeNotice.status) ||
      (allowDoneFirstAssessment && changeNotice.status === "Done");
    if (!firstAssessmentAllowed) {
      throw new ImpactMutationRejected(
        changeNotice.status === "Cancelled"
          ? "Cancelled Change Notices do not accept first Impact assessments."
          : "Change Notice lifecycle does not allow a first Impact assessment."
      );
    }
    if (operation !== "createDecision") {
      throw new ImpactMutationRejected(
        `Impact operation "${operation}" is not valid without an existing assessment.`
      );
    }
    const validation = validateChangeNoticeImpactFirstAssessment({
      targetType: input.targetType,
      decisionStatus: input.decisionStatus,
      noActionReasonCode: input.noActionReasonCode ?? null,
      rationale: input.rationale,
      resolutionNote: input.resolutionNote,
      confirmNoPurchasingInterventionRemains:
        input.confirmNoPurchasingInterventionRemains,
      expectedRevision: input.expectedRevision
    });
    if (!validation.valid) {
      throw new ImpactMutationRejected(validation.message);
    }
    return {
      input,
      operation,
      existing: null,
      previousValues: null,
      nextValues: {
        decisionStatus: input.decisionStatus,
        noActionReasonCode: validation.noActionReasonCode,
        rationale: validation.rationale,
        resolutionNote: validation.resolutionNote
      },
      previousSnapshot: null,
      requiresEvidence: true
    };
  }

  if (
    existing.targetType !== input.targetType ||
    existing.targetId !== input.targetId
  ) {
    throw new ImpactMutationRejected(
      "Stored Impact decision identity is inconsistent."
    );
  }
  if (
    !Number.isInteger(existing.revision) ||
    existing.revision <= 0 ||
    typeof existing.assessedBy !== "string" ||
    typeof existing.assessedAt !== "string"
  ) {
    throw new ImpactMutationRejected(
      "Stored Impact decision revision or assessment metadata is invalid."
    );
  }
  if (input.expectedRevision === undefined || input.expectedRevision === null) {
    throw new ImpactMutationRejected(
      "Existing Impact assessments require an expected decision revision."
    );
  }
  if (input.expectedRevision !== existing.revision) {
    throw new ImpactMutationRejected(IMPACT_REVISION_CONFLICT_MESSAGE);
  }

  const previousValues = impactExistingDecisionValues(existing);
  if (
    existing.noActionReasonCode !== null &&
    existing.noActionReasonCode !== undefined &&
    !impactIn(
      existing.noActionReasonCode,
      changeNoticeImpactNoActionReasonCodes
    )
  ) {
    throw new ImpactMutationRejected(
      "Stored Impact decision has an unsupported No Action reason."
    );
  }

  if (operation === "resolveActionRequired") {
    if (
      !changeNoticeStageFlow.includes(changeNotice.status) &&
      changeNotice.status !== "Cancelled"
    ) {
      throw new ImpactMutationRejected(
        "Change Notice lifecycle does not allow Impact resolution."
      );
    }
    const resolutionValidation = validateChangeNoticeImpactFirstAssessment({
      targetType: input.targetType,
      decisionStatus: "Resolved",
      noActionReasonCode: input.noActionReasonCode ?? null,
      rationale: previousValues.rationale,
      resolutionNote: input.resolutionNote,
      confirmNoPurchasingInterventionRemains:
        input.confirmNoPurchasingInterventionRemains,
      expectedRevision: undefined
    });
    if (!resolutionValidation.valid) {
      throw new ImpactMutationRejected(resolutionValidation.message);
    }
    const preservedSnapshot = existing.assessmentSnapshot;
    if (
      existing.snapshotVersion !== 1 ||
      !isCanonicalStoredImpactSnapshot(input.targetType, preservedSnapshot) ||
      !snapshotIdentityMatches(
        input.targetType,
        preservedSnapshot,
        input.targetId
      )
    ) {
      throw new ImpactMutationRejected(
        "Stored Impact assessment snapshot is unavailable for resolution."
      );
    }
    const preservedSnapshotJson = preservedSnapshot as Json;
    return {
      input,
      operation,
      existing,
      previousValues,
      nextValues: {
        decisionStatus: "Resolved",
        noActionReasonCode: null,
        rationale: previousValues.rationale,
        resolutionNote: resolutionValidation.resolutionNote
      },
      previousSnapshot: preservedSnapshotJson,
      requiresEvidence: false
    };
  }

  if (!changeNoticeStageFlow.includes(changeNotice.status)) {
    throw new ImpactMutationRejected(
      changeNotice.status === "Cancelled"
        ? "Cancelled Change Notices do not accept Impact reassessment."
        : "Change Notice lifecycle does not allow Impact reassessment."
    );
  }
  if (
    existingStatus === "No action required" &&
    input.decisionStatus === "Resolved"
  ) {
    throw new ImpactMutationRejected(
      IMPACT_NO_ACTION_RESOLUTION_INVALID_MESSAGE
    );
  }

  const nextReason =
    input.decisionStatus === "No action required"
      ? input.noActionReasonCode === undefined
        ? existingStatus === "No action required"
          ? previousValues.noActionReasonCode
          : null
        : (input.noActionReasonCode ?? null)
      : input.noActionReasonCode === undefined
        ? null
        : input.noActionReasonCode;
  const nextRationale =
    input.rationale === undefined
      ? previousValues.rationale
      : impactTrimmedNullableText(input.rationale);
  const nextResolutionNote =
    input.decisionStatus === "Resolved"
      ? input.resolutionNote === undefined
        ? previousValues.resolutionNote
        : impactTrimmedNullableText(input.resolutionNote)
      : input.resolutionNote === undefined
        ? null
        : impactTrimmedNullableText(input.resolutionNote);

  if (
    existingStatus !== input.decisionStatus &&
    (!input.rationale || input.rationale.trim().length === 0)
  ) {
    throw new ImpactMutationRejected(
      "Changing an existing Impact conclusion requires written rationale."
    );
  }

  const preservesPurchasingReason =
    previousValues.noActionReasonCode ===
      "No purchasing intervention remains" &&
    nextReason === "No purchasing intervention remains" &&
    (input.noActionReasonCode === undefined ||
      input.noActionReasonCode === previousValues.noActionReasonCode) &&
    input.confirmNoPurchasingInterventionRemains === undefined;
  const validation = validateChangeNoticeImpactFirstAssessment({
    targetType: input.targetType,
    decisionStatus: input.decisionStatus,
    noActionReasonCode: nextReason,
    rationale: nextRationale,
    resolutionNote: nextResolutionNote,
    confirmNoPurchasingInterventionRemains: preservesPurchasingReason
      ? true
      : input.confirmNoPurchasingInterventionRemains,
    expectedRevision: undefined
  });
  if (!validation.valid) {
    throw new ImpactMutationRejected(validation.message);
  }

  return {
    input,
    operation,
    existing,
    previousValues,
    nextValues: {
      decisionStatus: input.decisionStatus,
      noActionReasonCode: validation.noActionReasonCode,
      rationale: validation.rationale,
      resolutionNote: validation.resolutionNote
    },
    previousSnapshot: null,
    requiresEvidence: true
  };
}

async function prepareImpactDecisionBatch(
  trx: KyselyTx,
  inputs: ChangeNoticeImpactDecisionMutationInput[],
  options: {
    allowDoneFirstAssessment?: boolean;
    requirePreviewFingerprint?: boolean;
  } = {}
): Promise<ImpactDecisionPlan[]> {
  const changeNotice = await loadImpactMutationChangeNotice(trx, inputs[0]);
  const existingByTarget = await loadImpactMutationExistingDecisions(
    trx,
    inputs
  );
  const preflight = inputs.map((input) =>
    planImpactDecisionWithoutEvidence(
      input,
      changeNotice,
      existingByTarget.get(impactTargetKey(input.targetType, input.targetId)),
      options.allowDoneFirstAssessment
    )
  );

  const resolutionPlans = preflight
    .filter(
      (plan) =>
        plan.operation === "resolveActionRequired" && plan.existing !== null
    )
    .sort((left, right) =>
      (left.existing?.id ?? "").localeCompare(right.existing?.id ?? "")
    );
  for (const plan of resolutionPlans) {
    await lockAndValidateImpactResolutionTasks(
      trx,
      plan.input,
      plan.existing!.id
    );
  }

  const evidenceInputs = preflight
    .filter(
      (plan) => plan.requiresEvidence || options.requirePreviewFingerprint
    )
    .map((plan) => plan.input);
  const evidenceByTarget = await loadImpactMutationEvidence(
    trx,
    evidenceInputs
  );
  const existingDecisionIds = preflight.flatMap((plan) =>
    plan.existing && plan.requiresEvidence ? [plan.existing.id] : []
  );
  const provenanceByDecision = await loadImpactMutationProvenance(
    trx,
    inputs[0].companyId,
    existingDecisionIds
  );

  return Promise.all(
    preflight.map(async (plan) => {
      const evidence = evidenceByTarget.get(
        impactTargetKey(plan.input.targetType, plan.input.targetId)
      );
      if (!plan.requiresEvidence) {
        if (options.requirePreviewFingerprint) {
          if (!evidence) {
            throw new ImpactMutationRejected(
              "Complete Impact assessment evidence is unavailable."
            );
          }
          const expectedFingerprint = plan.input.expectedSnapshotFingerprint;
          const currentFingerprint =
            await createChangeNoticeImpactPreviewFingerprint({
              targetType: plan.input.targetType,
              snapshot: evidence.snapshot,
              affectedItemId: evidence.affectedItemId,
              affectedItemSourceId: evidence.affectedItemSourceId
            });
          if (
            expectedFingerprint === undefined ||
            expectedFingerprint !== currentFingerprint
          ) {
            throw new ImpactMutationRejected(
              CHANGE_NOTICE_IMPACT_BULK_PREVIEW_STALE_MESSAGE
            );
          }
        }
        return {
          ...plan,
          evidence: null,
          newSnapshot: plan.previousSnapshot,
          priorAssessmentWasChanged: false,
          decisionValuesChanged: true,
          provenanceRows: [],
          provenanceChanged: false
        };
      }
      if (!evidence) {
        throw new ImpactMutationRejected(
          "Complete Impact assessment evidence is unavailable."
        );
      }
      if (options.requirePreviewFingerprint) {
        const expectedFingerprint = plan.input.expectedSnapshotFingerprint;
        const currentFingerprint =
          await createChangeNoticeImpactPreviewFingerprint({
            targetType: plan.input.targetType,
            snapshot: evidence.snapshot,
            affectedItemId: evidence.affectedItemId,
            affectedItemSourceId: evidence.affectedItemSourceId
          });
        if (
          expectedFingerprint === undefined ||
          expectedFingerprint !== currentFingerprint
        ) {
          throw new ImpactMutationRejected(
            CHANGE_NOTICE_IMPACT_BULK_PREVIEW_STALE_MESSAGE
          );
        }
      }
      if (!plan.existing) {
        return {
          ...plan,
          evidence,
          newSnapshot: evidence.snapshot as Json,
          priorAssessmentWasChanged: false,
          decisionValuesChanged: true,
          provenanceRows: [],
          provenanceChanged: false
        };
      }

      const previousSnapshot = plan.existing.assessmentSnapshot;
      if (
        !isCanonicalStoredImpactSnapshot(
          plan.input.targetType,
          previousSnapshot
        )
      ) {
        throw new ImpactMutationRejected(
          "Stored Impact assessment snapshot is unavailable for reassessment."
        );
      }
      const snapshotFreshness = compareChangeNoticeImpactSnapshot(
        plan.input.targetType,
        evidence.snapshot,
        previousSnapshot,
        plan.existing.snapshotVersion
      );
      if (snapshotFreshness === "Unknown") {
        throw new ImpactMutationRejected(
          "Stored Impact assessment snapshot is unavailable for reassessment."
        );
      }
      const priorAssessmentWasChanged =
        snapshotFreshness === "Changed since assessment";
      const decisionValuesChanged =
        plan.previousValues?.decisionStatus !==
          plan.nextValues.decisionStatus ||
        plan.previousValues?.noActionReasonCode !==
          plan.nextValues.noActionReasonCode ||
        plan.previousValues?.rationale !== plan.nextValues.rationale ||
        plan.previousValues?.resolutionNote !==
          plan.nextValues.resolutionNote ||
        priorAssessmentWasChanged;
      const provenanceRows = provenanceByDecision.get(plan.existing.id) ?? [];
      const openRows = provenanceRows.filter(
        (row) => row.endedAt === null || row.endedAt === undefined
      );
      if (openRows.length > 1) {
        throw new ImpactMutationRejected(
          "Impact decision has more than one current provenance cause."
        );
      }
      const openProvenance = openRows[0];
      const provenanceChanged =
        !openProvenance ||
        openProvenance.affectedItemId !== evidence.affectedItemId ||
        openProvenance.affectedItemSourceId !== evidence.affectedItemSourceId;

      return {
        ...plan,
        evidence,
        newSnapshot: evidence.snapshot as Json,
        priorAssessmentWasChanged,
        decisionValuesChanged,
        provenanceRows,
        provenanceChanged,
        previousSnapshot: previousSnapshot as Json
      };
    })
  );
}

async function applyImpactDecisionPlan(
  trx: KyselyTx,
  plan: ImpactDecisionPlan
): Promise<ChangeNoticeImpactDecisionWriteData> {
  const input = plan.input;
  if (!plan.existing) {
    if (!plan.evidence) {
      throw new ImpactMutationRejected(
        "Complete Impact assessment evidence is unavailable."
      );
    }
    const now = datetime.timestamp();
    const snapshotJson = plan.evidence.snapshot as Json;
    const insertedDecision = await trx
      .insertInto("changeOrderImpactDecision")
      .values({
        companyId: input.companyId,
        changeNoticeId: input.changeNoticeId,
        targetType: input.targetType,
        targetId: input.targetId,
        decisionStatus: plan.nextValues.decisionStatus,
        noActionReasonCode: plan.nextValues.noActionReasonCode,
        rationale: plan.nextValues.rationale,
        resolutionNote: plan.nextValues.resolutionNote,
        assessmentSnapshot: snapshotJson,
        snapshotVersion: 1,
        assessedBy: input.userId,
        assessedAt: now,
        revision: 1,
        createdBy: input.userId,
        createdAt: now
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const decisionId = insertedDecision.id;

    await trx
      .insertInto("changeOrderImpactDecisionAffectedItem")
      .values({
        companyId: input.companyId,
        decisionId,
        affectedItemId: plan.evidence.affectedItemId,
        affectedItemSourceId: plan.evidence.affectedItemSourceId,
        affectedItemLabel: plan.evidence.affectedItemLabel,
        startedAt: now,
        startedBy: input.userId,
        createdBy: input.userId,
        createdAt: now
      })
      .execute();

    await trx
      .insertInto("changeOrderImpactDecisionHistory")
      .values([
        {
          companyId: input.companyId,
          decisionId,
          targetType: input.targetType,
          targetId: input.targetId,
          eventType: "Decision created",
          previousStatus: null,
          newStatus: plan.nextValues.decisionStatus,
          previousReasonCode: null,
          newReasonCode: plan.nextValues.noActionReasonCode,
          previousSnapshot: null,
          newSnapshot: snapshotJson,
          rationale: plan.nextValues.rationale,
          resolutionNote: plan.nextValues.resolutionNote,
          priorAssessmentWasChanged: false,
          createdBy: input.userId,
          createdAt: now
        },
        {
          companyId: input.companyId,
          decisionId,
          targetType: input.targetType,
          targetId: input.targetId,
          eventType: "Provenance started",
          previousStatus: null,
          newStatus: plan.nextValues.decisionStatus,
          previousReasonCode: null,
          newReasonCode: plan.nextValues.noActionReasonCode,
          previousSnapshot: null,
          newSnapshot: snapshotJson,
          rationale: plan.nextValues.rationale,
          resolutionNote: plan.nextValues.resolutionNote,
          relatedAffectedItemId: plan.evidence.affectedItemId,
          priorAssessmentWasChanged: false,
          createdBy: input.userId,
          createdAt: now
        }
      ])
      .execute();

    return {
      operation: plan.operation,
      decision: {
        id: decisionId,
        targetType: input.targetType,
        targetId: input.targetId,
        decisionStatus: plan.nextValues.decisionStatus,
        noActionReasonCode: plan.nextValues.noActionReasonCode,
        rationale: plan.nextValues.rationale,
        resolutionNote: plan.nextValues.resolutionNote,
        assessmentSnapshot: plan.evidence.snapshot,
        snapshotVersion: 1,
        assessedBy: input.userId,
        assessedAt: now,
        revision: 1
      }
    };
  }

  const existing = plan.existing;
  if (plan.operation === "resolveActionRequired") {
    const now = datetime.timestamp();
    const nextRevision = existing.revision + 1;
    const updatedDecision = await trx
      .updateTable("changeOrderImpactDecision")
      .set({
        decisionStatus: "Resolved",
        noActionReasonCode: null,
        resolutionNote: plan.nextValues.resolutionNote,
        revision: nextRevision,
        updatedBy: input.userId,
        updatedAt: now
      })
      .where("id", "=", existing.id)
      .where("companyId", "=", input.companyId)
      .where("changeNoticeId", "=", input.changeNoticeId)
      .where("targetType", "=", input.targetType)
      .where("targetId", "=", input.targetId)
      .where("revision", "=", existing.revision)
      .returning("id")
      .executeTakeFirst();
    if (!updatedDecision) {
      throw new ImpactMutationRejected(IMPACT_REVISION_CONFLICT_MESSAGE);
    }
    const preservedSnapshotJson = plan.previousSnapshot as Json;
    await trx
      .insertInto("changeOrderImpactDecisionHistory")
      .values([
        {
          companyId: input.companyId,
          decisionId: existing.id,
          targetType: input.targetType,
          targetId: input.targetId,
          eventType: "Decision resolved",
          previousStatus: plan.previousValues?.decisionStatus ?? null,
          newStatus: "Resolved",
          previousReasonCode: plan.previousValues?.noActionReasonCode ?? null,
          newReasonCode: null,
          previousSnapshot: preservedSnapshotJson,
          newSnapshot: preservedSnapshotJson,
          rationale: plan.previousValues?.rationale ?? null,
          resolutionNote: plan.nextValues.resolutionNote,
          priorAssessmentWasChanged: false,
          createdBy: input.userId,
          createdAt: now
        }
      ])
      .execute();
    return {
      operation: plan.operation,
      decision: {
        id: existing.id,
        targetType: input.targetType,
        targetId: input.targetId,
        decisionStatus: "Resolved",
        noActionReasonCode: null,
        rationale: plan.previousValues?.rationale ?? null,
        resolutionNote: plan.nextValues.resolutionNote,
        assessmentSnapshot: plan.previousSnapshot as ChangeNoticeImpactSnapshot,
        snapshotVersion: existing.snapshotVersion,
        assessedBy: existing.assessedBy,
        assessedAt: existing.assessedAt,
        revision: nextRevision
      }
    };
  }

  if (!plan.evidence || !plan.previousValues || !plan.previousSnapshot) {
    throw new ImpactMutationRejected(
      "Complete Impact assessment evidence is unavailable."
    );
  }
  const now = datetime.timestamp();
  const previousSnapshotJson = plan.previousSnapshot as Json;
  const newSnapshotJson = plan.newSnapshot as Json;
  const nextRevision = existing.revision + (plan.decisionValuesChanged ? 1 : 0);
  if (plan.decisionValuesChanged) {
    const updatedDecision = await trx
      .updateTable("changeOrderImpactDecision")
      .set({
        decisionStatus: plan.nextValues.decisionStatus,
        noActionReasonCode: plan.nextValues.noActionReasonCode,
        rationale: plan.nextValues.rationale,
        resolutionNote: plan.nextValues.resolutionNote,
        assessmentSnapshot: newSnapshotJson,
        snapshotVersion: 1,
        assessedBy: input.userId,
        assessedAt: now,
        revision: nextRevision,
        updatedBy: input.userId,
        updatedAt: now
      })
      .where("id", "=", existing.id)
      .where("companyId", "=", input.companyId)
      .where("changeNoticeId", "=", input.changeNoticeId)
      .where("targetType", "=", input.targetType)
      .where("targetId", "=", input.targetId)
      .where("revision", "=", existing.revision)
      .returning("id")
      .executeTakeFirst();
    if (!updatedDecision) {
      throw new ImpactMutationRejected(IMPACT_REVISION_CONFLICT_MESSAGE);
    }
  }

  const provenance = await reconcileImpactDecisionProvenance(
    trx,
    input,
    existing,
    plan.previousValues,
    plan.nextValues,
    plan.evidence,
    previousSnapshotJson,
    newSnapshotJson,
    plan.priorAssessmentWasChanged,
    now,
    plan.provenanceRows
  );
  const historyRows: Database["public"]["Tables"]["changeOrderImpactDecisionHistory"]["Insert"][] =
    [];
  if (plan.decisionValuesChanged) {
    historyRows.push(
      impactDecisionHistoryRow({
        companyId: input.companyId,
        decisionId: existing.id,
        targetType: input.targetType,
        targetId: input.targetId,
        eventType: impactHistoryEventForOperation(
          plan.operation as Exclude<
            ChangeNoticeImpactDecisionOperation,
            "createDecision" | "noOp" | "resolveActionRequired"
          >
        ),
        previous: plan.previousValues,
        next: plan.nextValues,
        previousSnapshot: previousSnapshotJson,
        newSnapshot: newSnapshotJson,
        rationale: plan.nextValues.rationale,
        resolutionNote: plan.nextValues.resolutionNote,
        priorAssessmentWasChanged: plan.priorAssessmentWasChanged,
        createdBy: input.userId,
        createdAt: now
      })
    );
  }
  historyRows.push(...provenance.historyRows);
  if (historyRows.length > 0) {
    await trx
      .insertInto("changeOrderImpactDecisionHistory")
      .values(historyRows)
      .execute();
  }

  const noOp = !plan.decisionValuesChanged && !plan.provenanceChanged;
  return {
    operation: noOp ? "noOp" : plan.operation,
    decision: {
      id: existing.id,
      targetType: input.targetType,
      targetId: input.targetId,
      decisionStatus: plan.nextValues.decisionStatus,
      noActionReasonCode: plan.nextValues.noActionReasonCode,
      rationale: plan.nextValues.rationale,
      resolutionNote: plan.nextValues.resolutionNote,
      assessmentSnapshot: plan.decisionValuesChanged
        ? plan.evidence.snapshot
        : (plan.previousSnapshot as ChangeNoticeImpactSnapshot),
      snapshotVersion: plan.decisionValuesChanged
        ? 1
        : existing.snapshotVersion,
      assessedBy: plan.decisionValuesChanged
        ? input.userId
        : existing.assessedBy,
      assessedAt: plan.decisionValuesChanged ? now : existing.assessedAt,
      revision: nextRevision
    }
  };
}

function impactBulkFailure(
  cause: unknown,
  inputs: ChangeNoticeImpactDecisionMutationInput[]
): ImpactDecisionWriteFailure {
  const message = isImpactTargetUniqueConflict(cause)
    ? IMPACT_FIRST_ASSESSMENT_CONFLICT_MESSAGE
    : impactMutationErrorMessage(cause);
  const identities = inputs
    .map((input) => `${input.targetType}/${input.targetId}`)
    .join(", ");
  return impactMutationFailure(`${message} Bulk targets: ${identities}.`);
}

/**
 * Apply explicit target decisions atomically. This raw service boundary is
 * intentionally not an MCP contract; the server wrapper resolves
 * credential-bound permission access before calling it because Kysely bypasses
 * RLS.
 */
export async function writeChangeNoticeImpactDecisions(
  db: Kysely<KyselyDatabase>,
  input: ChangeNoticeImpactDecisionBulkMutationInput
): Promise<ChangeNoticeImpactDecisionBulkWriteResult> {
  const validation = validateImpactDecisionBulkMutationInput(input);
  if ("error" in validation) return validation.error;

  const fingerprintCount = validation.decisions.filter(
    (decision) => decision.expectedSnapshotFingerprint !== undefined
  ).length;
  if (
    fingerprintCount > 0 &&
    fingerprintCount !== validation.decisions.length
  ) {
    return impactMutationFailure(
      "Every bulk target must include the reviewed Impact preview."
    );
  }

  try {
    return await db.transaction().execute(async (trx) => {
      const plans = await prepareImpactDecisionBatch(
        trx,
        validation.decisions,
        {
          requirePreviewFingerprint: fingerprintCount > 0
        }
      );
      let appliedCount = 0;
      let noOpCount = 0;
      for (const plan of plans) {
        const result = await applyImpactDecisionPlan(trx, plan);
        if (result.operation === "noOp") noOpCount += 1;
        else appliedCount += 1;
      }
      return {
        data: {
          changeNoticeId: input.changeNoticeId,
          selectedCount: validation.decisions.length,
          appliedCount,
          noOpCount
        },
        error: null
      } satisfies ChangeNoticeImpactDecisionBulkWriteResult;
    });
  } catch (cause) {
    if (!(cause instanceof ImpactMutationRejected)) {
      logger.error("Failed to write Change Notice Impact decision bulk", {
        error: cause,
        companyId: input.companyId,
        changeNoticeId: input.changeNoticeId,
        targetCount: validation.decisions.length
      });
    }
    return impactBulkFailure(cause, validation.decisions);
  }
}

export async function writeChangeNoticeImpactDecision(
  db: Kysely<KyselyDatabase>,
  input: ChangeNoticeImpactDecisionMutationInput
): Promise<ChangeNoticeImpactDecisionWriteResult> {
  const validation = validateImpactDecisionMutationInput(input);
  if (validation) return validation;

  try {
    return await db.transaction().execute(async (trx) => {
      const plans = await prepareImpactDecisionBatch(trx, [input]);
      const result = await applyImpactDecisionPlan(trx, plans[0]);
      return {
        data: result,
        error: null
      } satisfies ChangeNoticeImpactDecisionWriteResult;
    });
  } catch (cause) {
    if (isImpactTargetUniqueConflict(cause)) {
      return impactMutationFailure(IMPACT_FIRST_ASSESSMENT_CONFLICT_MESSAGE);
    }
    if (!(cause instanceof ImpactMutationRejected)) {
      logger.error("Failed to write Change Notice Impact assessment", {
        error: cause,
        companyId: input.companyId,
        changeNoticeId: input.changeNoticeId,
        targetType: input.targetType,
        targetId: input.targetId
      });
    }
    return impactMutationFailure(impactMutationErrorMessage(cause));
  }
}

const CHANGE_NOTICE_IMPACT_TASK_DEFAULT_NAME =
  "Follow up on Change Notice operational impact";

const impactTaskOriginValues = new Set<string>(changeNoticeActionTaskOrigins);

const IMPACT_TASK_SERVER_FIELDS = new Set([
  "id",
  "status",
  "taskOrigin",
  "actionTypeId",
  "sortOrder",
  "completedDate",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy"
]);

type ImpactTaskDecisionRow = {
  id: string;
  companyId: string;
  changeNoticeId: string;
  targetType: ChangeNoticeImpactTargetType;
  targetId: string;
  decisionStatus: string;
  noActionReasonCode: string | null;
  rationale: string | null;
  resolutionNote: string | null;
  assessmentSnapshot: Json | null;
};

type ImpactTaskRow = {
  id: string;
  companyId: string;
  changeOrderId: string;
  taskOrigin: string;
};

type ImpactTaskChangeNoticeRow = {
  id: string;
  companyId: string;
  status: Database["public"]["Enums"]["changeOrderStatus"];
};

function impactTaskFailure<T>({
  cause,
  fallback = "Impact task operation failed."
}: {
  cause: unknown;
  fallback?: string;
}): { data: T | null; error: { message: string } } {
  return {
    data: null,
    error: {
      message: cause instanceof Error ? cause.message : fallback
    }
  };
}

function isImpactTaskTargetType(
  value: unknown
): value is ChangeNoticeImpactTargetType {
  return (
    typeof value === "string" &&
    (changeNoticeImpactTargetTypes as readonly string[]).includes(value)
  );
}

function validateImpactTaskSourceAccess(
  input:
    | ChangeNoticeImpactTaskCreateMutationInput
    | ChangeNoticeImpactTaskRelationshipMutationInput
): string | null {
  if (!isImpactRecord(input.sourceAccess)) {
    return "Impact source access is invalid.";
  }
  if (
    typeof input.sourceAccess.purchaseOrderLine !== "boolean" ||
    typeof input.sourceAccess.job !== "boolean" ||
    typeof input.sourceAccess.jobMaterial !== "boolean"
  ) {
    return "Impact source access is invalid.";
  }
  if (!impactSourceAccessAllows(input.targetType, input.sourceAccess)) {
    return "Impact source access is restricted for this target.";
  }
  return null;
}

function validateImpactTaskIdentity(input: unknown): string | null {
  if (!isImpactRecord(input)) return "Impact task input is invalid.";
  const value = input as Record<string, unknown>;
  if (
    typeof value.companyId !== "string" ||
    value.companyId.length === 0 ||
    typeof value.userId !== "string" ||
    value.userId.length === 0 ||
    typeof value.changeNoticeId !== "string" ||
    value.changeNoticeId.length === 0 ||
    typeof value.targetId !== "string" ||
    value.targetId.length === 0 ||
    !isImpactTaskTargetType(value.targetType)
  ) {
    return "Impact task identity is required.";
  }
  return null;
}

function validateImpactTaskRelationshipInput(input: unknown): string | null {
  const identityError = validateImpactTaskIdentity(input);
  if (identityError) return identityError;
  if (!isImpactRecord(input)) return "Impact task input is invalid.";
  if (
    typeof input.decisionId !== "string" ||
    input.decisionId.length === 0 ||
    typeof input.actionTaskId !== "string" ||
    input.actionTaskId.length === 0
  ) {
    return "Impact decision and action task are required.";
  }
  return validateImpactTaskSourceAccess(
    input as unknown as ChangeNoticeImpactTaskRelationshipMutationInput
  );
}

function validateImpactTaskCreateInput(input: unknown): string | null {
  const identityError = validateImpactTaskIdentity(input);
  if (identityError) return identityError;
  if (!isImpactRecord(input)) return "Impact task input is invalid.";

  const value = input as Record<string, unknown>;
  const decision = value.decision;
  const bootstrapDecision = value.bootstrapDecision;
  const hasDecision = isImpactRecord(decision);
  const hasBootstrap = isImpactRecord(bootstrapDecision);
  if ((hasDecision ? 1 : 0) + (hasBootstrap ? 1 : 0) !== 1) {
    return "Impact task creation requires an existing decision or an Action Required bootstrap.";
  }

  if (hasDecision) {
    if (
      typeof decision.decisionId !== "string" ||
      decision.decisionId.length === 0 ||
      decision.targetType !== value.targetType ||
      decision.targetId !== value.targetId
    ) {
      return "Impact task decision target does not match the requested target.";
    }
    if (
      Object.keys(decision).some(
        (key) =>
          key !== "decisionId" && key !== "targetType" && key !== "targetId"
      )
    ) {
      return "Impact task decision contains unsupported fields.";
    }
  }

  if (hasBootstrap) {
    if (
      bootstrapDecision.decisionStatus !== "Action required" ||
      typeof bootstrapDecision.rationale !== "string" ||
      bootstrapDecision.rationale.trim().length === 0
    ) {
      return "Action required needs written follow-up rationale.";
    }
    if (
      Object.keys(bootstrapDecision).some(
        (key) => key !== "decisionStatus" && key !== "rationale"
      )
    ) {
      return "Impact bootstrap contains unsupported fields.";
    }
  }

  if (!isImpactRecord(value.task)) return "Impact task fields are required.";
  const task = value.task as Record<string, unknown>;
  if ([...IMPACT_TASK_SERVER_FIELDS].some((key) => key in task)) {
    return "Impact task lifecycle fields are server-derived.";
  }
  if (
    Object.keys(task).some(
      (key) => !["name", "notes", "assignee", "dueDate"].includes(key)
    )
  ) {
    return "Impact task contains unsupported fields.";
  }
  if (
    task.name !== undefined &&
    (typeof task.name !== "string" || task.name.trim().length === 0)
  ) {
    return "Impact task name must be non-empty text.";
  }
  if (
    task.assignee !== undefined &&
    task.assignee !== null &&
    (typeof task.assignee !== "string" || task.assignee.trim().length === 0)
  ) {
    return "Impact task assignee must be text or null.";
  }
  if (
    task.dueDate !== undefined &&
    task.dueDate !== null &&
    (typeof task.dueDate !== "string" || task.dueDate.trim().length === 0)
  ) {
    return "Impact task due date must be text or null.";
  }

  return validateImpactTaskSourceAccess(
    input as unknown as ChangeNoticeImpactTaskCreateMutationInput
  );
}

async function loadImpactTaskChangeNotice(
  trx: KyselyTx,
  companyId: string,
  changeNoticeId: string
): Promise<ImpactTaskChangeNoticeRow> {
  const row = await trx
    .selectFrom("changeOrder")
    .select(["id", "companyId", "status"])
    .where("id", "=", changeNoticeId)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new ImpactMutationRejected("Change notice not found.");
  return row;
}

async function loadImpactTaskDecision(
  trx: KyselyTx,
  input:
    | ChangeNoticeImpactTaskRelationshipMutationInput
    | ChangeNoticeImpactTaskCreateMutationInput,
  decisionId: string,
  requireActionRequired = true
): Promise<ImpactTaskDecisionRow> {
  const row = (await trx
    .selectFrom("changeOrderImpactDecision")
    .select([
      "id",
      "companyId",
      "changeNoticeId",
      "targetType",
      "targetId",
      "decisionStatus",
      "noActionReasonCode",
      "rationale",
      "resolutionNote",
      "assessmentSnapshot"
    ])
    .where("id", "=", decisionId)
    .where("companyId", "=", input.companyId)
    .where("changeNoticeId", "=", input.changeNoticeId)
    .where("targetType", "=", input.targetType)
    .where("targetId", "=", input.targetId)
    .forUpdate()
    .executeTakeFirst()) as unknown as ImpactTaskDecisionRow | undefined;

  if (!row) throw new ImpactMutationRejected("Impact decision not found.");
  if (
    row.companyId !== input.companyId ||
    row.changeNoticeId !== input.changeNoticeId ||
    row.targetType !== input.targetType ||
    row.targetId !== input.targetId
  ) {
    throw new ImpactMutationRejected(
      "Impact decision does not belong to this Change Notice target."
    );
  }
  if (requireActionRequired && row.decisionStatus !== "Action required") {
    throw new ImpactMutationRejected(
      "Only Action required Impact decisions can receive follow-up tasks."
    );
  }
  if (!isImpactTaskTargetType(row.targetType)) {
    throw new ImpactMutationRejected(
      "Stored Impact target type is unsupported."
    );
  }
  return row;
}

async function loadImpactTask(
  trx: KyselyTx,
  input: ChangeNoticeImpactTaskRelationshipMutationInput
): Promise<ImpactTaskRow> {
  const row = (await trx
    .selectFrom("changeOrderActionTask")
    .select(["id", "companyId", "changeOrderId", "taskOrigin"])
    .where("id", "=", input.actionTaskId)
    .where("companyId", "=", input.companyId)
    .where("changeOrderId", "=", input.changeNoticeId)
    .forUpdate()
    .executeTakeFirst()) as unknown as ImpactTaskRow | undefined;
  if (!row) throw new ImpactMutationRejected("Action task not found.");
  if (
    row.companyId !== input.companyId ||
    row.changeOrderId !== input.changeNoticeId
  ) {
    throw new ImpactMutationRejected(
      "Action task does not belong to this Change Notice."
    );
  }
  if (!impactTaskOriginValues.has(row.taskOrigin)) {
    throw new ImpactMutationRejected(
      "Stored action task origin is unsupported."
    );
  }
  return row;
}

async function loadImpactTaskLink(
  trx: KyselyTx,
  input: ChangeNoticeImpactTaskRelationshipMutationInput
): Promise<{ decisionId: string; actionTaskId: string } | null> {
  const row = await trx
    .selectFrom("changeOrderImpactDecisionActionTask")
    .select(["decisionId", "actionTaskId"])
    .where("decisionId", "=", input.decisionId)
    .where("actionTaskId", "=", input.actionTaskId)
    .where("companyId", "=", input.companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) return null;
  if (
    row.decisionId !== input.decisionId ||
    row.actionTaskId !== input.actionTaskId
  ) {
    throw new ImpactMutationRejected(
      "Stored Impact task link is inconsistent."
    );
  }
  return row;
}

function impactTaskHistoryRow(input: {
  decision: ImpactTaskDecisionRow;
  eventType:
    | "Task linked"
    | "Task unlinked"
    | "Task designated as Impact follow-up";
  actionTaskId: string;
  userId: string;
  now: string;
  eventRationale?: string | null;
}): Database["public"]["Tables"]["changeOrderImpactDecisionHistory"]["Insert"] {
  return {
    companyId: input.decision.companyId,
    decisionId: input.decision.id,
    targetType: input.decision.targetType,
    targetId: input.decision.targetId,
    eventType: input.eventType,
    // Relationship/origin events are not assessment events. Do not duplicate
    // decision conclusions, rationale, resolution notes, or snapshots here.
    previousStatus: null,
    newStatus: null,
    previousReasonCode: null,
    newReasonCode: null,
    previousSnapshot: null,
    newSnapshot: null,
    rationale: input.eventRationale ?? null,
    resolutionNote: null,
    relatedActionTaskId: input.actionTaskId,
    relatedAffectedItemId: null,
    priorAssessmentWasChanged: false,
    createdBy: input.userId,
    createdAt: input.now
  };
}

function assertImpactTaskLifecycle(
  status: ImpactTaskChangeNoticeRow["status"],
  operation: "create" | "link" | "unlink" | "designate",
  taskOrigin?: string,
  decisionStatus?: string
): void {
  if (operation === "designate") {
    if (!changeNoticeOpenStatuses.includes(status)) {
      throw new ImpactMutationRejected(
        "Impact task designation is only allowed before the Change Notice is Done."
      );
    }
    return;
  }

  if (status === "Cancelled") {
    if (
      taskOrigin !== "Impact follow-up" ||
      decisionStatus !== "Action required"
    ) {
      throw new ImpactMutationRejected(
        "Cancelled Change Notices only allow cleanup of Impact follow-up tasks."
      );
    }
    return;
  }

  // Linking and unlinking are relationship operations, not task-content edits.
  // Done permits those operations for ordinary tasks too; their task origin still
  // controls whether the existing task-content routes may edit them.
  if (status === "Done") return;

  if (!changeNoticeStageFlow.includes(status)) {
    throw new ImpactMutationRejected(
      "Change Notice lifecycle does not allow Impact task operations."
    );
  }
}

function toImpactTaskDecisionRow(
  input: ChangeNoticeImpactTaskCreateMutationInput,
  decision: {
    id: string;
    targetType: ChangeNoticeImpactTargetType;
    targetId: string;
    decisionStatus: ChangeNoticeImpactDecisionStatus;
    noActionReasonCode: ChangeNoticeImpactNoActionReasonCode | null;
    rationale: string | null;
    resolutionNote: string | null;
    assessmentSnapshot: ChangeNoticeImpactSnapshot;
  }
): ImpactTaskDecisionRow {
  return {
    id: decision.id,
    companyId: input.companyId,
    changeNoticeId: input.changeNoticeId,
    targetType: decision.targetType,
    targetId: decision.targetId,
    decisionStatus: decision.decisionStatus,
    noActionReasonCode: decision.noActionReasonCode,
    rationale: decision.rationale,
    resolutionNote: decision.resolutionNote,
    assessmentSnapshot: decision.assessmentSnapshot
  };
}

/**
 * Create one Impact follow-up task and link it to an existing Action required
 * decision, or bootstrap the Action required decision in the same transaction.
 * The raw service is intentionally blocked from generic MCP execution; its
 * server wrapper resolves the user's source permissions first.
 */
export async function createChangeNoticeImpactTask(
  db: Kysely<KyselyDatabase>,
  input: ChangeNoticeImpactTaskCreateMutationInput
): Promise<ChangeNoticeImpactTaskCreateResult> {
  const validation = validateImpactTaskCreateInput(input);
  if (validation) return { data: null, error: { message: validation } };

  try {
    return await db.transaction().execute(async (trx) => {
      const changeNotice = await loadImpactTaskChangeNotice(
        trx,
        input.companyId,
        input.changeNoticeId
      );
      const bootstrap = input.bootstrapDecision !== undefined;
      let decision: ImpactTaskDecisionRow;
      let decisionCreated = false;

      if (bootstrap) {
        if (changeNotice.status === "Cancelled") {
          throw new ImpactMutationRejected(
            "Cancelled Change Notices cannot bootstrap an Impact decision."
          );
        }
        assertImpactTaskLifecycle(
          changeNotice.status,
          "create",
          "Impact follow-up"
        );
        const decisionInput: ChangeNoticeImpactDecisionMutationInput = {
          changeNoticeId: input.changeNoticeId,
          targetType: input.targetType,
          targetId: input.targetId,
          decisionStatus: "Action required",
          rationale: input.bootstrapDecision?.rationale,
          companyId: input.companyId,
          userId: input.userId,
          sourceAccess: input.sourceAccess
        };
        const existing = await loadImpactMutationExistingDecisions(trx, [
          decisionInput
        ]);
        if (existing.has(impactTargetKey(input.targetType, input.targetId))) {
          throw new ImpactMutationRejected(
            "Impact decision already exists; provide its decision anchor."
          );
        }
        const plans = await prepareImpactDecisionBatch(trx, [decisionInput], {
          allowDoneFirstAssessment: true
        });
        if (plans.length !== 1 || plans[0]?.existing) {
          throw new ImpactMutationRejected(
            "Impact decision bootstrap requires an unassessed target."
          );
        }
        const applied = await applyImpactDecisionPlan(trx, plans[0]);
        if (applied.operation !== "createDecision") {
          throw new ImpactMutationRejected(
            "Impact decision bootstrap did not create a decision."
          );
        }
        decision = toImpactTaskDecisionRow(input, applied.decision);
        decisionCreated = true;
      } else {
        const decisionRef = input.decision;
        if (!decisionRef) {
          throw new ImpactMutationRejected(
            "Impact decision anchor is required."
          );
        }
        decision = await loadImpactTaskDecision(
          trx,
          input,
          decisionRef.decisionId
        );
        assertImpactTaskLifecycle(
          changeNotice.status,
          "create",
          "Impact follow-up",
          decision.decisionStatus
        );
      }

      const taskFields = input.task;
      const lastTask = await trx
        .selectFrom("changeOrderActionTask")
        .select(["sortOrder"])
        .where("changeOrderId", "=", input.changeNoticeId)
        .where("companyId", "=", input.companyId)
        .orderBy("sortOrder", "desc")
        .orderBy("id", "desc")
        .executeTakeFirst();
      const now = datetime.timestamp();
      const taskValues: Database["public"]["Tables"]["changeOrderActionTask"]["Insert"] =
        {
          changeOrderId: input.changeNoticeId,
          name:
            taskFields.name?.trim() ?? CHANGE_NOTICE_IMPACT_TASK_DEFAULT_NAME,
          status: "Pending",
          actionTypeId: null,
          sortOrder: (lastTask?.sortOrder ?? 0) + 1,
          companyId: input.companyId,
          createdBy: input.userId,
          createdAt: now,
          taskOrigin: "Impact follow-up"
        };
      if (taskFields.notes !== undefined && taskFields.notes !== null) {
        taskValues.notes = taskFields.notes;
      }
      if (taskFields.assignee !== undefined) {
        taskValues.assignee = taskFields.assignee?.trim() ?? null;
      }
      if (taskFields.dueDate !== undefined) {
        taskValues.dueDate = taskFields.dueDate?.trim() || null;
      }

      const task = await trx
        .insertInto("changeOrderActionTask")
        .values(taskValues)
        .returning(["id", "status", "taskOrigin"])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto("changeOrderImpactDecisionActionTask")
        .values({
          decisionId: decision.id,
          actionTaskId: task.id,
          companyId: input.companyId,
          createdBy: input.userId,
          createdAt: now
        })
        .execute();

      await trx
        .insertInto("changeOrderImpactDecisionHistory")
        .values(
          impactTaskHistoryRow({
            decision,
            eventType: "Task linked",
            actionTaskId: task.id,
            userId: input.userId,
            now
          })
        )
        .execute();

      return {
        data: {
          decisionId: decision.id,
          actionTaskId: task.id,
          decisionCreated,
          taskOrigin: "Impact follow-up",
          status: task.status
        },
        error: null
      } satisfies ChangeNoticeImpactTaskCreateResult;
    });
  } catch (cause) {
    if (!(cause instanceof ImpactMutationRejected)) {
      logger.error("Failed to create Change Notice Impact task", {
        error: cause,
        companyId: input.companyId,
        changeNoticeId: input.changeNoticeId,
        targetType: input.targetType,
        targetId: input.targetId
      });
    }
    return impactTaskFailure({ cause });
  }
}

async function loadImpactTaskRelationshipContext(
  trx: KyselyTx,
  input: ChangeNoticeImpactTaskRelationshipMutationInput,
  operation: "link" | "unlink" | "designate"
): Promise<{
  changeNotice: ImpactTaskChangeNoticeRow;
  decision: ImpactTaskDecisionRow;
  task: ImpactTaskRow;
}> {
  const changeNotice = await loadImpactTaskChangeNotice(
    trx,
    input.companyId,
    input.changeNoticeId
  );
  const decision = await loadImpactTaskDecision(
    trx,
    input,
    input.decisionId,
    operation === "designate"
  );
  const task = await loadImpactTask(trx, input);
  assertImpactTaskLifecycle(
    changeNotice.status,
    operation,
    task.taskOrigin,
    decision.decisionStatus
  );
  return { changeNotice, decision, task };
}

/** Link an existing Change Notice action task to an Impact decision. */
export async function linkChangeNoticeImpactTask(
  db: Kysely<KyselyDatabase>,
  input: ChangeNoticeImpactTaskRelationshipMutationInput
): Promise<ChangeNoticeImpactTaskRelationshipResult> {
  const validation = validateImpactTaskRelationshipInput(input);
  if (validation) return { data: null, error: { message: validation } };

  try {
    return await db.transaction().execute(async (trx) => {
      const { decision, task } = await loadImpactTaskRelationshipContext(
        trx,
        input,
        "link"
      );
      const existing = await loadImpactTaskLink(trx, input);
      if (existing) {
        return {
          data: {
            decisionId: decision.id,
            actionTaskId: task.id,
            changed: false
          },
          error: null
        } satisfies ChangeNoticeImpactTaskRelationshipResult;
      }

      const now = datetime.timestamp();
      await trx
        .insertInto("changeOrderImpactDecisionActionTask")
        .values({
          decisionId: decision.id,
          actionTaskId: task.id,
          companyId: input.companyId,
          createdBy: input.userId,
          createdAt: now
        })
        .execute();
      await trx
        .insertInto("changeOrderImpactDecisionHistory")
        .values(
          impactTaskHistoryRow({
            decision,
            eventType: "Task linked",
            actionTaskId: task.id,
            userId: input.userId,
            now
          })
        )
        .execute();

      return {
        data: {
          decisionId: decision.id,
          actionTaskId: task.id,
          changed: true
        },
        error: null
      } satisfies ChangeNoticeImpactTaskRelationshipResult;
    });
  } catch (cause) {
    if (!(cause instanceof ImpactMutationRejected)) {
      logger.error("Failed to link Change Notice Impact task", {
        error: cause,
        companyId: input.companyId,
        changeNoticeId: input.changeNoticeId,
        decisionId: input.decisionId,
        actionTaskId: input.actionTaskId
      });
    }
    return impactTaskFailure({ cause });
  }
}

/** Unlink an existing Change Notice action task without resolving its decision. */
export async function unlinkChangeNoticeImpactTask(
  db: Kysely<KyselyDatabase>,
  input: ChangeNoticeImpactTaskRelationshipMutationInput
): Promise<ChangeNoticeImpactTaskRelationshipResult> {
  const validation = validateImpactTaskRelationshipInput(input);
  if (validation) return { data: null, error: { message: validation } };

  try {
    return await db.transaction().execute(async (trx) => {
      const { decision, task } = await loadImpactTaskRelationshipContext(
        trx,
        input,
        "unlink"
      );
      const existing = await loadImpactTaskLink(trx, input);
      if (!existing) {
        return {
          data: {
            decisionId: decision.id,
            actionTaskId: task.id,
            changed: false
          },
          error: null
        } satisfies ChangeNoticeImpactTaskRelationshipResult;
      }

      const deleted = await trx
        .deleteFrom("changeOrderImpactDecisionActionTask")
        .where("decisionId", "=", input.decisionId)
        .where("actionTaskId", "=", input.actionTaskId)
        .where("companyId", "=", input.companyId)
        .executeTakeFirst();
      if (!deleted || Number(deleted.numDeletedRows) !== 1) {
        throw new ImpactMutationRejected(
          "Impact task link changed while it was being removed."
        );
      }

      const now = datetime.timestamp();
      await trx
        .insertInto("changeOrderImpactDecisionHistory")
        .values(
          impactTaskHistoryRow({
            decision,
            eventType: "Task unlinked",
            actionTaskId: task.id,
            userId: input.userId,
            now
          })
        )
        .execute();

      return {
        data: {
          decisionId: decision.id,
          actionTaskId: task.id,
          changed: true
        },
        error: null
      } satisfies ChangeNoticeImpactTaskRelationshipResult;
    });
  } catch (cause) {
    if (!(cause instanceof ImpactMutationRejected)) {
      logger.error("Failed to unlink Change Notice Impact task", {
        error: cause,
        companyId: input.companyId,
        changeNoticeId: input.changeNoticeId,
        decisionId: input.decisionId,
        actionTaskId: input.actionTaskId
      });
    }
    return impactTaskFailure({ cause });
  }
}

/** Designate an ordinary task as Impact follow-up before Done. */
export async function designateChangeNoticeImpactTask(
  db: Kysely<KyselyDatabase>,
  input: ChangeNoticeImpactTaskRelationshipMutationInput
): Promise<ChangeNoticeImpactTaskDesignationResult> {
  const validation = validateImpactTaskRelationshipInput(input);
  if (validation) return { data: null, error: { message: validation } };

  try {
    return await db.transaction().execute(async (trx) => {
      const { decision, task } = await loadImpactTaskRelationshipContext(
        trx,
        input,
        "designate"
      );
      const existing = await loadImpactTaskLink(trx, input);
      const now = datetime.timestamp();

      if (task.taskOrigin === "Impact follow-up") {
        if (!existing) {
          await trx
            .insertInto("changeOrderImpactDecisionActionTask")
            .values({
              decisionId: decision.id,
              actionTaskId: task.id,
              companyId: input.companyId,
              createdBy: input.userId,
              createdAt: now
            })
            .execute();
          await trx
            .insertInto("changeOrderImpactDecisionHistory")
            .values(
              impactTaskHistoryRow({
                decision,
                eventType: "Task linked",
                actionTaskId: task.id,
                userId: input.userId,
                now
              })
            )
            .execute();
        }
        return {
          data: {
            decisionId: decision.id,
            actionTaskId: task.id,
            previousTaskOrigin: "Impact follow-up",
            taskOrigin: "Impact follow-up",
            changed: !existing
          },
          error: null
        } satisfies ChangeNoticeImpactTaskDesignationResult;
      }
      if (
        task.taskOrigin !== "Template-owned" &&
        task.taskOrigin !== "Manual"
      ) {
        throw new ImpactMutationRejected(
          "Only ordinary action tasks can be designated as Impact follow-up."
        );
      }

      // Designation owns the origin transition; relationship creation and both
      // feature-history events remain in this same transaction.
      const updated = await trx
        .updateTable("changeOrderActionTask")
        .set({
          taskOrigin: "Impact follow-up",
          updatedBy: input.userId,
          updatedAt: now
        })
        .where("id", "=", task.id)
        .where("changeOrderId", "=", input.changeNoticeId)
        .where("companyId", "=", input.companyId)
        .where("taskOrigin", "=", task.taskOrigin)
        .executeTakeFirst();
      if (!updated || Number(updated.numUpdatedRows) !== 1) {
        throw new ImpactMutationRejected(
          "Action task origin changed while it was being designated."
        );
      }

      if (!existing) {
        await trx
          .insertInto("changeOrderImpactDecisionActionTask")
          .values({
            decisionId: decision.id,
            actionTaskId: task.id,
            companyId: input.companyId,
            createdBy: input.userId,
            createdAt: now
          })
          .execute();
        await trx
          .insertInto("changeOrderImpactDecisionHistory")
          .values(
            impactTaskHistoryRow({
              decision,
              eventType: "Task linked",
              actionTaskId: task.id,
              userId: input.userId,
              now
            })
          )
          .execute();
      }

      await trx
        .insertInto("changeOrderImpactDecisionHistory")
        .values(
          impactTaskHistoryRow({
            decision,
            eventType: "Task designated as Impact follow-up",
            actionTaskId: task.id,
            userId: input.userId,
            now,
            eventRationale: `Task origin changed from ${task.taskOrigin} to Impact follow-up`
          })
        )
        .execute();

      return {
        data: {
          decisionId: decision.id,
          actionTaskId: task.id,
          previousTaskOrigin: task.taskOrigin as "Template-owned" | "Manual",
          taskOrigin: "Impact follow-up",
          changed: true
        },
        error: null
      } satisfies ChangeNoticeImpactTaskDesignationResult;
    });
  } catch (cause) {
    if (!(cause instanceof ImpactMutationRejected)) {
      logger.error("Failed to designate Change Notice Impact task", {
        error: cause,
        companyId: input.companyId,
        changeNoticeId: input.changeNoticeId,
        decisionId: input.decisionId,
        actionTaskId: input.actionTaskId
      });
    }
    return impactTaskFailure({ cause });
  }
}

const IMPACT_PROVENANCE_SOURCE_DELETED_REASON = "Impact source deleted";
const IMPACT_PROVENANCE_SCOPE_REMOVED_REASON =
  "Affected item removed from Change Notice";
const IMPACT_PROVENANCE_RECONCILIATION_CHANGED_REASON =
  "Affected item provenance changed during reconciliation";
const IMPACT_PROVENANCE_STARTED_REASON =
  "Affected item provenance started during reconciliation";

type ImpactReconciliationOperation = "noOp" | "start" | "end" | "replace";

type ImpactReconciliationPlan = {
  decisionId: string;
  targetType: ChangeNoticeImpactTargetType;
  targetId: string;
  operation: ImpactReconciliationOperation;
  previous: {
    id: string;
    affectedItemId: string;
    affectedItemSourceId: string;
  } | null;
  next: {
    affectedItemId: string;
    affectedItemSourceId: string;
    affectedItemLabel: string | null;
  } | null;
  endReason: string | null;
};

type ImpactReconciliationPlanningInput = {
  decision: Pick<
    ImpactReconciliationPlan,
    "decisionId" | "targetType" | "targetId"
  >;
  currentProvenance: ImpactReconciliationPlan["previous"];
  /** Null means the exact authorized source lookup found no source row. */
  currentSourceItemId: string | null;
  currentAffectedItems: Array<{
    id: string;
    itemId: string;
    label: string | null;
  }>;
  endOnly: boolean;
};

type ImpactReconciliationDecision = {
  id: string;
  companyId: string;
  changeNoticeId: string;
  targetType: ChangeNoticeImpactTargetType;
  targetId: string;
  decisionStatus: string;
  noActionReasonCode: string | null;
  rationale: string | null;
  resolutionNote: string | null;
  assessmentSnapshot: Json;
};

type ImpactReconciliationAffectedItem = {
  id: string;
  companyId: string;
  changeOrderId: string;
  itemId: string;
};

type ImpactReconciliationProvenance = {
  id: string;
  companyId: string;
  decisionId: string;
  affectedItemId: string;
  affectedItemSourceId: string;
  affectedItemLabel: string | null;
  endedAt: unknown;
};

type ImpactReconciliationSource = {
  id: string;
  companyId: string;
  itemId: string | null;
};

function impactReconciliationAccessTypes(
  sourceAccess: unknown
): ChangeNoticeImpactTargetType[] | null {
  if (!isImpactRecord(sourceAccess)) return null;
  if (
    typeof sourceAccess.purchaseOrderLine !== "boolean" ||
    typeof sourceAccess.job !== "boolean" ||
    typeof sourceAccess.jobMaterial !== "boolean"
  ) {
    return null;
  }

  const types: ChangeNoticeImpactTargetType[] = [];
  if (sourceAccess.purchaseOrderLine) types.push("purchaseOrderLine");
  // Job and Job Material share the production source boundary. Do not process
  // either one from an inconsistent partial capability map.
  if (sourceAccess.job && sourceAccess.jobMaterial) {
    types.push("job", "jobMaterial");
  }
  return types;
}

async function readImpactReconciliationSources(
  trx: KyselyTx,
  targetType: ChangeNoticeImpactTargetType,
  targetIds: string[],
  companyId: string
): Promise<ImpactReconciliationSource[]> {
  const rows: ImpactReconciliationSource[] = [];
  for (const batch of impactIdBatches(targetIds)) {
    const result =
      targetType === "purchaseOrderLine"
        ? await trx
            .selectFrom("purchaseOrderLine")
            .select(["id", "itemId", "companyId"])
            .where("companyId", "=", companyId)
            .where("id", "in", batch)
            .orderBy("id", "asc")
            .execute()
        : targetType === "job"
          ? await trx
              .selectFrom("job")
              .select(["id", "itemId", "companyId"])
              .where("companyId", "=", companyId)
              .where("id", "in", batch)
              .orderBy("id", "asc")
              .execute()
          : await trx
              .selectFrom("jobMaterial")
              .select(["id", "itemId", "companyId"])
              .where("companyId", "=", companyId)
              .where("id", "in", batch)
              .orderBy("id", "asc")
              .execute();

    rows.push(...(result as unknown as ImpactReconciliationSource[]));
  }

  const requestedIds = new Set(targetIds);
  const seenIds = new Set<string>();
  for (const row of rows) {
    if (
      typeof row.id !== "string" ||
      !requestedIds.has(row.id) ||
      seenIds.has(row.id)
    ) {
      throw new ImpactMutationRejected(
        `Complete ${targetType} source evidence is unavailable.`
      );
    }
    if (row.companyId !== companyId) {
      throw new ImpactMutationRejected(
        `Complete ${targetType} source evidence is unavailable.`
      );
    }
    if (typeof row.itemId !== "string" || row.itemId.length === 0) {
      throw new ImpactMutationRejected(
        `Complete ${targetType} source evidence is unavailable.`
      );
    }
    seenIds.add(row.id);
  }

  // A missing requested ID is meaningful only because every exact batch above
  // succeeded. The caller can therefore distinguish Source deleted from a
  // failed or truncated scan without treating an empty result as safe.
  return rows;
}

async function readImpactReconciliationItemLabels(
  trx: KyselyTx,
  itemIds: string[],
  companyId: string
): Promise<Map<string, string | null>> {
  const labels = new Map<string, string | null>();
  const requestedIds = new Set(itemIds);
  const seenIds = new Set<string>();

  for (const batch of impactIdBatches(itemIds)) {
    const rows = await trx
      .selectFrom("item")
      .select([
        "id",
        "companyId",
        "readableId",
        "readableIdWithRevision",
        "name"
      ])
      .where("companyId", "=", companyId)
      .where("id", "in", batch)
      .orderBy("id", "asc")
      .execute();

    for (const row of rows) {
      if (
        typeof row.id !== "string" ||
        !requestedIds.has(row.id) ||
        seenIds.has(row.id) ||
        row.companyId !== companyId
      ) {
        throw new ImpactMutationRejected(
          "Complete affected-item label evidence is unavailable."
        );
      }
      labels.set(
        row.id,
        impactNullableString(row.readableIdWithRevision) ??
          impactNullableString(row.readableId) ??
          impactNullableString(row.name)
      );
      seenIds.add(row.id);
    }
  }

  return labels;
}

function planChangeNoticeImpactProvenanceReconciliation(
  input: ImpactReconciliationPlanningInput
): ImpactReconciliationPlan {
  const affectedByItemId = new Map(
    input.currentAffectedItems.map((affectedItem) => [
      affectedItem.itemId,
      affectedItem
    ])
  );
  const labels = new Map(
    input.currentAffectedItems.map((affectedItem) => [
      affectedItem.itemId,
      affectedItem.label
    ])
  );
  const currentCause = input.currentSourceItemId
    ? affectedByItemId.get(input.currentSourceItemId)
    : undefined;
  const nextCause =
    input.currentSourceItemId && currentCause
      ? {
          affectedItemId: currentCause.id,
          affectedItemSourceId: input.currentSourceItemId,
          affectedItemLabel: labels.get(input.currentSourceItemId) ?? null
        }
      : null;

  if (!input.currentProvenance) {
    return {
      ...input.decision,
      operation: nextCause && !input.endOnly ? "start" : "noOp",
      previous: null,
      next: input.endOnly ? null : nextCause,
      endReason: null
    };
  }

  const previous = input.currentProvenance;
  const matchesCurrent =
    nextCause !== null &&
    previous.affectedItemId === nextCause.affectedItemId &&
    previous.affectedItemSourceId === nextCause.affectedItemSourceId;
  if (matchesCurrent) {
    return {
      ...input.decision,
      operation: "noOp",
      previous,
      next: nextCause,
      endReason: null
    };
  }

  const sourceItemChanged =
    input.currentSourceItemId !== null &&
    input.currentSourceItemId !== previous.affectedItemSourceId;
  const endReason =
    input.currentSourceItemId === null
      ? IMPACT_PROVENANCE_SOURCE_DELETED_REASON
      : sourceItemChanged
        ? IMPACT_PROVENANCE_RECONCILIATION_CHANGED_REASON
        : IMPACT_PROVENANCE_SCOPE_REMOVED_REASON;

  return {
    ...input.decision,
    operation: input.endOnly || nextCause === null ? "end" : "replace",
    previous,
    next: input.endOnly ? null : nextCause,
    endReason
  };
}

function impactReconciliationHistoryRow(input: {
  decision: ImpactReconciliationDecision;
  companyId: string;
  userId: string;
  now: string;
  eventType: "Provenance started" | "Provenance ended";
  rationale: string;
  relatedAffectedItemId: string;
}): Database["public"]["Tables"]["changeOrderImpactDecisionHistory"]["Insert"] {
  return {
    companyId: input.companyId,
    decisionId: input.decision.id,
    targetType: input.decision.targetType,
    targetId: input.decision.targetId,
    eventType: input.eventType,
    previousStatus: input.decision.decisionStatus,
    newStatus: input.decision.decisionStatus,
    previousReasonCode: input.decision.noActionReasonCode,
    newReasonCode: input.decision.noActionReasonCode,
    previousSnapshot: input.decision.assessmentSnapshot,
    newSnapshot: input.decision.assessmentSnapshot,
    rationale: input.rationale,
    resolutionNote: input.decision.resolutionNote,
    relatedAffectedItemId: input.relatedAffectedItemId,
    priorAssessmentWasChanged: false,
    createdBy: input.userId,
    createdAt: input.now
  };
}

async function applyImpactProvenanceReconciliation(
  trx: KyselyTx,
  input: ChangeNoticeImpactProvenanceReconciliationInput,
  decisionsById: Map<string, ImpactReconciliationDecision>,
  plans: ImpactReconciliationPlan[]
): Promise<{ started: number; ended: number }> {
  const changedPlans = plans.filter((plan) => plan.operation !== "noOp");
  if (changedPlans.length === 0) return { started: 0, ended: 0 };

  const now = datetime.timestamp();
  const endGroups = new Map<string, string[]>();
  for (const plan of changedPlans) {
    if (!plan.previous || !plan.endReason) continue;
    const provenanceIds = endGroups.get(plan.endReason) ?? [];
    provenanceIds.push(plan.previous.id);
    endGroups.set(plan.endReason, provenanceIds);
  }

  let ended = 0;
  for (const [reason, provenanceIds] of endGroups) {
    for (const batch of impactIdBatches(provenanceIds)) {
      const result = await trx
        .updateTable("changeOrderImpactDecisionAffectedItem")
        .set({
          endedAt: now,
          endedBy: input.userId,
          endedReason: reason,
          updatedAt: now,
          updatedBy: input.userId
        })
        .where("companyId", "=", input.companyId)
        .where("id", "in", batch)
        .where("endedAt", "is", null)
        .executeTakeFirst();
      if (!result || Number(result.numUpdatedRows) !== batch.length) {
        throw new ImpactMutationRejected(
          "Impact provenance changed while it was being reconciled."
        );
      }
      ended += batch.length;
    }
  }

  const starts = changedPlans.flatMap((plan) => {
    if (
      !plan.next ||
      (plan.operation !== "start" && plan.operation !== "replace")
    ) {
      return [];
    }
    return [
      {
        companyId: input.companyId,
        decisionId: plan.decisionId,
        affectedItemId: plan.next.affectedItemId,
        affectedItemSourceId: plan.next.affectedItemSourceId,
        affectedItemLabel: plan.next.affectedItemLabel,
        startedAt: now,
        startedBy: input.userId,
        createdBy: input.userId,
        createdAt: now
      }
    ];
  });
  if (starts.length > 0) {
    await trx
      .insertInto("changeOrderImpactDecisionAffectedItem")
      .values(starts)
      .execute();
  }

  const historyRows: Database["public"]["Tables"]["changeOrderImpactDecisionHistory"]["Insert"][] =
    [];
  for (const plan of changedPlans) {
    const decision = decisionsById.get(plan.decisionId);
    if (!decision) {
      throw new ImpactMutationRejected(
        "Impact provenance decision identity is inconsistent."
      );
    }
    if (plan.previous && plan.endReason) {
      historyRows.push(
        impactReconciliationHistoryRow({
          decision,
          companyId: input.companyId,
          userId: input.userId,
          now,
          eventType: "Provenance ended",
          rationale: plan.endReason,
          relatedAffectedItemId: plan.previous.affectedItemId
        })
      );
    }
    if (
      plan.next &&
      (plan.operation === "start" || plan.operation === "replace")
    ) {
      historyRows.push(
        impactReconciliationHistoryRow({
          decision,
          companyId: input.companyId,
          userId: input.userId,
          now,
          eventType: "Provenance started",
          rationale: IMPACT_PROVENANCE_STARTED_REASON,
          relatedAffectedItemId: plan.next.affectedItemId
        })
      );
    }
  }

  if (historyRows.length > 0) {
    await trx
      .insertInto("changeOrderImpactDecisionHistory")
      .values(historyRows)
      .execute();
  }

  return { started: starts.length, ended };
}

/**
 * Reconcile persisted affected-item provenance for existing Impact decisions.
 *
 * This is deliberately narrower than assessment/reassessment: it never updates
 * the decision row, snapshot, conclusion, revision, or decision audit fields.
 * A complete exact source lookup may end an open interval when its source is
 * deleted or no longer matches current Change Notice scope. Cancelled notices
 * are end-only; they never start or replace a relationship.
 */
export async function reconcileChangeNoticeImpactProvenance(
  db: Kysely<KyselyDatabase>,
  input: ChangeNoticeImpactProvenanceReconciliationInput
): Promise<ChangeNoticeImpactProvenanceReconciliationResult> {
  if (!isImpactRecord(input)) {
    return impactMutationFailure(
      "Impact provenance reconciliation input is invalid."
    );
  }
  if (
    typeof input.companyId !== "string" ||
    input.companyId.length === 0 ||
    typeof input.userId !== "string" ||
    input.userId.length === 0 ||
    typeof input.changeNoticeId !== "string" ||
    input.changeNoticeId.length === 0
  ) {
    return impactMutationFailure(
      "Impact provenance reconciliation identity is required."
    );
  }

  const accessibleTypes = impactReconciliationAccessTypes(input.sourceAccess);
  if (!accessibleTypes) {
    return impactMutationFailure("Impact source access is invalid.");
  }
  const restrictedTargetTypes = changeNoticeImpactTargetTypes.filter(
    (targetType) => !accessibleTypes.includes(targetType)
  );

  try {
    return await db.transaction().execute(async (trx) => {
      const changeNotice = await trx
        .selectFrom("changeOrder")
        .select(["id", "companyId", "status"])
        .where("id", "=", input.changeNoticeId)
        .where("companyId", "=", input.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!changeNotice) {
        throw new ImpactMutationRejected("Change notice not found.");
      }

      const endOnly = changeNotice.status === "Cancelled";
      if (!endOnly && !changeNoticeStageFlow.includes(changeNotice.status)) {
        throw new ImpactMutationRejected(
          "Change Notice lifecycle does not allow Impact provenance reconciliation."
        );
      }

      if (accessibleTypes.length === 0) {
        return {
          data: {
            changeNoticeId: input.changeNoticeId,
            changeNoticeStatus: changeNotice.status,
            started: 0,
            ended: 0,
            restrictedTargetTypes
          },
          error: null
        } satisfies ChangeNoticeImpactProvenanceReconciliationResult;
      }

      const decisionRows = await trx
        .selectFrom("changeOrderImpactDecision")
        .select([
          "id",
          "companyId",
          "changeNoticeId",
          "targetType",
          "targetId",
          "decisionStatus",
          "noActionReasonCode",
          "rationale",
          "resolutionNote",
          "assessmentSnapshot"
        ])
        .where("companyId", "=", input.companyId)
        .where("changeNoticeId", "=", input.changeNoticeId)
        .where("targetType", "in", accessibleTypes)
        .orderBy("targetType", "asc")
        .orderBy("targetId", "asc")
        .forUpdate()
        .execute();

      const decisions: ImpactReconciliationDecision[] = [];
      const decisionsById = new Map<string, ImpactReconciliationDecision>();
      const decisionsByTarget = new Map<string, ImpactReconciliationDecision>();
      for (const row of decisionRows) {
        const id = impactPersistedRequiredString(row.id, "decision.id");
        const targetId = impactPersistedRequiredString(
          row.targetId,
          "decision.targetId"
        );
        if (
          !id.ok ||
          !targetId.ok ||
          row.companyId !== input.companyId ||
          row.changeNoticeId !== input.changeNoticeId
        ) {
          throw new ImpactMutationRejected(
            "Stored Impact decision identity is inconsistent."
          );
        }
        if (!impactIn(row.targetType, changeNoticeImpactTargetTypes)) {
          throw new ImpactMutationRejected(
            "Stored Impact decision type is unsupported."
          );
        }
        if (!accessibleTypes.includes(row.targetType)) {
          throw new ImpactMutationRejected(
            "Impact source access is restricted for this target."
          );
        }
        if (!impactIn(row.decisionStatus, changeNoticeImpactDecisionStatuses)) {
          throw new ImpactMutationRejected(
            "Stored Impact decision has an unsupported status."
          );
        }
        if (row.decisionStatus === "No action required") {
          if (
            !impactIn(
              row.noActionReasonCode,
              changeNoticeImpactNoActionReasonCodes
            )
          ) {
            throw new ImpactMutationRejected(
              "Stored Impact decision has an unsupported No Action reason."
            );
          }
        } else if (row.noActionReasonCode !== null) {
          throw new ImpactMutationRejected(
            "Stored Impact decision has an invalid No Action reason."
          );
        }
        if (
          decisionsById.has(id.value) ||
          decisionsByTarget.has(impactTargetKey(row.targetType, targetId.value))
        ) {
          throw new ImpactMutationRejected(
            "Stored Impact decisions contain a duplicate identity."
          );
        }

        const decision: ImpactReconciliationDecision = {
          id: id.value,
          companyId: row.companyId,
          changeNoticeId: row.changeNoticeId,
          targetType: row.targetType,
          targetId: targetId.value,
          decisionStatus: row.decisionStatus,
          noActionReasonCode: row.noActionReasonCode,
          rationale: row.rationale,
          resolutionNote: row.resolutionNote,
          assessmentSnapshot: row.assessmentSnapshot
        };
        decisions.push(decision);
        decisionsById.set(decision.id, decision);
        decisionsByTarget.set(
          impactTargetKey(decision.targetType, decision.targetId),
          decision
        );
      }

      if (decisions.length === 0) {
        return {
          data: {
            changeNoticeId: input.changeNoticeId,
            changeNoticeStatus: changeNotice.status,
            started: 0,
            ended: 0,
            restrictedTargetTypes
          },
          error: null
        } satisfies ChangeNoticeImpactProvenanceReconciliationResult;
      }

      const affectedRows = await trx
        .selectFrom("changeOrderAffectedItem")
        .select(["id", "companyId", "changeOrderId", "itemId"])
        .where("companyId", "=", input.companyId)
        .where("changeOrderId", "=", input.changeNoticeId)
        .orderBy("id", "asc")
        .forUpdate()
        .execute();
      const affectedByItemId = new Map<
        string,
        ImpactReconciliationAffectedItem
      >();
      const affectedIds = new Set<string>();
      for (const row of affectedRows) {
        const id = impactPersistedRequiredString(row.id, "affectedItem.id");
        const itemId = impactPersistedRequiredString(
          row.itemId,
          "affectedItem.itemId"
        );
        if (
          !id.ok ||
          !itemId.ok ||
          row.companyId !== input.companyId ||
          row.changeOrderId !== input.changeNoticeId
        ) {
          throw new ImpactMutationRejected(
            "Current Change Notice scope is unavailable."
          );
        }
        if (affectedIds.has(id.value) || affectedByItemId.has(itemId.value)) {
          throw new ImpactMutationRejected(
            "Change Notice has more than one current affected-item cause."
          );
        }
        const affected: ImpactReconciliationAffectedItem = {
          id: id.value,
          companyId: row.companyId,
          changeOrderId: row.changeOrderId,
          itemId: itemId.value
        };
        affectedIds.add(affected.id);
        affectedByItemId.set(affected.itemId, affected);
      }

      const provenanceRows =
        decisions.length === 0
          ? []
          : ((await trx
              .selectFrom("changeOrderImpactDecisionAffectedItem")
              .select([
                "id",
                "companyId",
                "decisionId",
                "affectedItemId",
                "affectedItemSourceId",
                "affectedItemLabel",
                "endedAt"
              ])
              .where("companyId", "=", input.companyId)
              .where(
                "decisionId",
                "in",
                decisions.map((decision) => decision.id)
              )
              .orderBy("decisionId", "asc")
              .orderBy("startedAt", "asc")
              .orderBy("id", "asc")
              .forUpdate()
              .execute()) as unknown as ImpactReconciliationProvenance[]);
      const provenanceByDecision = new Map<
        string,
        ImpactReconciliationProvenance[]
      >();
      const provenanceIds = new Set<string>();
      for (const row of provenanceRows) {
        const id = impactPersistedRequiredString(row.id, "provenance.id");
        const decisionId = impactPersistedRequiredString(
          row.decisionId,
          "provenance.decisionId"
        );
        const affectedItemId = impactPersistedRequiredString(
          row.affectedItemId,
          "provenance.affectedItemId"
        );
        const sourceId = impactPersistedRequiredString(
          row.affectedItemSourceId,
          "provenance.affectedItemSourceId"
        );
        if (!id.ok || !decisionId.ok || !affectedItemId.ok || !sourceId.ok) {
          throw new ImpactMutationRejected(
            "Stored Impact provenance identity is inconsistent."
          );
        }
        if (
          !decisionsById.has(decisionId.value) ||
          provenanceIds.has(id.value) ||
          row.companyId !== input.companyId
        ) {
          throw new ImpactMutationRejected(
            "Stored Impact provenance identity is inconsistent."
          );
        }
        provenanceIds.add(id.value);
        const provenance: ImpactReconciliationProvenance = {
          id: id.value,
          companyId: row.companyId,
          decisionId: decisionId.value,
          affectedItemId: affectedItemId.value,
          affectedItemSourceId: sourceId.value,
          affectedItemLabel: row.affectedItemLabel,
          endedAt: row.endedAt
        };
        const rowsForDecision =
          provenanceByDecision.get(decisionId.value) ?? [];
        rowsForDecision.push(provenance);
        provenanceByDecision.set(decisionId.value, rowsForDecision);
      }

      for (const decision of decisions) {
        const openRows = (provenanceByDecision.get(decision.id) ?? []).filter(
          (row) => row.endedAt === null || row.endedAt === undefined
        );
        if (openRows.length > 1) {
          throw new ImpactMutationRejected(
            "Impact decision has more than one current provenance cause."
          );
        }
      }

      const labels = await readImpactReconciliationItemLabels(
        trx,
        [...affectedByItemId.keys()],
        input.companyId
      );
      const sourcesByTarget = new Map<string, ImpactReconciliationSource>();
      for (const targetType of accessibleTypes) {
        const targetIds = decisions
          .filter((decision) => decision.targetType === targetType)
          .map((decision) => decision.targetId);
        const sources = await readImpactReconciliationSources(
          trx,
          targetType,
          targetIds,
          input.companyId
        );
        for (const source of sources) {
          sourcesByTarget.set(impactTargetKey(targetType, source.id), source);
        }
      }

      const currentAffectedItems = [...affectedByItemId.values()].map(
        (affectedItem) => ({
          id: affectedItem.id,
          itemId: affectedItem.itemId,
          label: labels.get(affectedItem.itemId) ?? null
        })
      );
      const plans = decisions.map((decision) => {
        const open = (provenanceByDecision.get(decision.id) ?? []).find(
          (row) => row.endedAt === null || row.endedAt === undefined
        );
        return planChangeNoticeImpactProvenanceReconciliation({
          decision: {
            decisionId: decision.id,
            targetType: decision.targetType,
            targetId: decision.targetId
          },
          currentProvenance: open
            ? {
                id: open.id,
                affectedItemId: open.affectedItemId,
                affectedItemSourceId: open.affectedItemSourceId
              }
            : null,
          currentSourceItemId:
            sourcesByTarget.get(
              impactTargetKey(decision.targetType, decision.targetId)
            )?.itemId ?? null,
          currentAffectedItems,
          endOnly
        });
      });

      const counts = await applyImpactProvenanceReconciliation(
        trx,
        input,
        decisionsById,
        plans
      );

      return {
        data: {
          changeNoticeId: input.changeNoticeId,
          changeNoticeStatus: changeNotice.status,
          ...counts,
          restrictedTargetTypes
        },
        error: null
      } satisfies ChangeNoticeImpactProvenanceReconciliationResult;
    });
  } catch (cause) {
    if (!(cause instanceof ImpactMutationRejected)) {
      logger.error("Failed to reconcile Change Notice Impact provenance", {
        error: cause,
        companyId: input.companyId,
        changeNoticeId: input.changeNoticeId
      });
    }
    return impactMutationFailure(impactMutationErrorMessage(cause));
  }
}
