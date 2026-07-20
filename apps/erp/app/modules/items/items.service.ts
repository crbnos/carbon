import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type {
  ExpressionBuilder,
  Kysely,
  KyselyDatabase,
  KyselyTx
} from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { getLocalTimeZone, now, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type { nonConformancePriority } from "../quality/quality.models";
import type {
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator
} from "../shared";
import {
  lookupBuyPriceFromMap,
  type MethodType,
  type PriceBreak,
  type SourcingType,
  type SupplierPriceMap
} from "../shared";
import {
  type ChangeOrderChangeType,
  type ChangeOrderError,
  type ChangeOrderItemDiff,
  changeOrderOpenStatuses,
  type changeOrderStatus,
  type changeOrderTaskStatus,
  type changeOrderType,
  type configurationParameterGroupOrderValidator,
  type configurationParameterGroupValidator,
  type configurationParameterOrderValidator,
  type configurationParameterValidator,
  type configurationRuleValidator,
  type consumableValidator,
  type customerPartValidator,
  type getMethodValidator,
  ItemTrackingType,
  isAllowedChangeOrderTransition,
  type itemCostValidator,
  type itemManufacturingValidator,
  type itemPlanningValidator,
  type itemPostingGroupValidator,
  type itemPurchasingValidator,
  type itemSupersessionValidator,
  type itemTrackingTypes,
  type itemUnitSalePriceValidator,
  type itemValidator,
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
  type OperationChildrenDiff,
  type OperationDiffEntry,
  type partValidator,
  type pickMethodSortMethods,
  type pickMethodValidator,
  type serviceValidator,
  type shelfLifeModes,
  type shelfLifeTriggerTimings,
  type supplierPartValidator,
  type toolValidator,
  type unitOfMeasureValidator
} from "./items.models";
import type { InventoryItemType } from "./types";

const logger = getLogger("erp", "items");

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
    // in item pickers/production until the change order is released. Manual
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
      requiresInspection: item.requiresInspection,
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
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%,mpn.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
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
  const dateOneYearAgo = today(getLocalTimeZone())
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
  const result = await client.storage
    .from("private")
    .list(`${companyId}/parts/${itemId}`);
  return result.data || [];
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
    .select("*", {
      count: "exact"
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args.search) {
    query = query.or(
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%,mpn.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
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
    query = query.ilike("name", `%${args.search}%`);
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
    query = query.ilike("name", `%${args.search}%`);
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
    query = query.ilike("name", `%${args.search}%`);
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

export async function getMethodMaterialsByMakeMethod(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  return client
    .from("methodMaterial")
    .select(
      "*, item(name, itemTrackingType, replenishmentSystem, defaultMethodType, sourcingType)"
    )
    .eq("makeMethodId", makeMethodId)
    .order("order", { ascending: true });
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
      "*, methodOperationTool(*), methodOperationParameter(*), methodOperationStep(*)"
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
      "id, parentMaterialId, jobMakeMethodId, jobId, quantity:quantityToIssue, documentReadableId:jobReadableId, documentId:jobId, dueDate"
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
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%,mpn.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
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
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%`
    );
  }

  if (args.group) {
    query = query.eq("itemPostingGroupId", args.group);
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
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
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%,mpn.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
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
      updatedAt: today(getLocalTimeZone()).toString()
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
      updatedAt: today(getLocalTimeZone()).toString()
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
          updatedAt: now(getLocalTimeZone()).toAbsoluteString()
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
      updatedAt: today(getLocalTimeZone()).toString()
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
  const updatedAt = now(getLocalTimeZone()).toAbsoluteString();

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
  const updatedAt = now(getLocalTimeZone()).toAbsoluteString();

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

  const updatedAt = now(getLocalTimeZone()).toAbsoluteString();

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

  const updatedAt = now(getLocalTimeZone()).toAbsoluteString();

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
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", consumable.id),
    client
      .from("consumable")
      .update({
        ...sanitize(consumableUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
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
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", part.id),
    client
      .from("part")
      .update({
        ...sanitize(partUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
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
    updatedBy: string;
  }
) {
  return client
    .from("itemReplenishment")
    .update(sanitize(itemPurchasing))
    .eq("itemId", itemPurchasing.itemId);
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
    // Seed storageUnitIds from the child item's default location/storage-unit
    // if the caller didn't already provide one for that location. Respects
    // the form value when supplied, adds a sensible default otherwise.
    const seededStorageUnitIds = await resolveMethodMaterialStorageUnitIds(
      client,
      {
        itemId: methodMaterial.itemId,
        current: methodMaterial.storageUnitIds as
          | Record<string, string>
          | undefined
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
  return client
    .from("methodMaterial")
    .update(sanitize({ ...methodMaterial, materialMakeMethodId }))
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
      .insert([methodOperation])
      .select("id")
      .single();
  }
  return client
    .from("methodOperation")
    .update(sanitize(methodOperation))
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
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", material.id),
    client
      .from("material")
      .update({
        ...sanitize(materialUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
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
    query = query.ilike("name", `%${args.search}%`);
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
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", service.id),
    // service.id is the item uuid; the service row is keyed by readableId
    client
      .from("service")
      .update({
        ...sanitize(serviceUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
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
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", tool.id),
    client
      .from("tool")
      .update({
        ...sanitize(toolUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
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
// Change Orders — header CRUD, stage transitions, list, and CO Types config.
// =============================================================================

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------
export async function getChangeOrder(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
) {
  return client
    .from("changeOrder")
    .select("*")
    .eq("id", changeOrderId)
    .eq("companyId", companyId)
    .single();
}

export async function getChangeOrders(
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
export async function insertChangeOrder(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    changeOrderId?: string;
    name: string;
    type?: (typeof changeOrderType)[number];
    priority?: (typeof nonConformancePriority)[number];
    changeOrderTypeId?: string;
    nonConformanceId?: string;
    openDate: string;
    reasonForChange?: Json;
    description?: Json;
    dueDate?: string;
    assignee?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; changeOrderId: string } | null;
  error: ChangeOrderError | null;
}> {
  let changeOrderId: string;
  if (input.changeOrderId) {
    changeOrderId = input.changeOrderId;
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
    changeOrderId = seq.data;
  }

  const result = await client
    .from("changeOrder")
    .insert({
      changeOrderId,
      name: input.name,
      type: input.type ?? "Engineering",
      priority: input.priority ?? null,
      changeOrderTypeId: input.changeOrderTypeId ?? null,
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
  // Actions multiselect (reconciled by setChangeOrderActionTasks).

  return {
    data: { id: result.data.id, changeOrderId: result.data.changeOrderId },
    error: null
  };
}

export async function updateChangeOrder(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    changeOrderId?: string;
    name?: string;
    type?: (typeof changeOrderType)[number];
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
  error: ChangeOrderError | null;
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

export async function deleteChangeOrder(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
) {
  // Discard each affected item's CO-owned Draft first (the Draft make method for
  // a Version, or the revealed inactive item for a Revision/New Part). These are
  // NOT FK children of the change order, so the cascade below won't remove them —
  // only the changeOrderAffectedItem rows cascade. Without this, deleting a CO
  // orphans its drafts (mirrors removeChangeOrderAffectedItem's cleanup).
  const affected = await client
    .from("changeOrderAffectedItem")
    .select("draftMakeMethodId, newItemId")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId);
  if (!affected.error && affected.data) {
    for (const item of affected.data) {
      await discardChangeOrderDraft(client, item, companyId);
    }
  }

  // Remaining children (affected items, action tasks) cascade via ON DELETE CASCADE.
  return client
    .from("changeOrder")
    .delete()
    .eq("id", changeOrderId)
    .eq("companyId", companyId);
}

// -----------------------------------------------------------------------------
// Stage transition — the single guarded writer (G8), a compare-and-swap (G2).
// Forward-only (isAllowedChangeOrderTransition).
// -----------------------------------------------------------------------------
export async function updateChangeOrderStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    companyId: string;
    fromStatus: (typeof changeOrderStatus)[number];
    toStatus: (typeof changeOrderStatus)[number];
    assignee?: string | null;
    updatedBy: string;
  }
): Promise<{
  data: { id: string; status: (typeof changeOrderStatus)[number] } | null;
  error: { message: string } | null;
}> {
  const { id, companyId, fromStatus, toStatus, ...rest } = update;

  if (!isAllowedChangeOrderTransition(fromStatus, toStatus)) {
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
    status: (typeof changeOrderStatus)[number];
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
          "The change order was updated by someone else. Refresh and try again."
      }
    };
  }
  return { data: result.data, error: null };
}

// -----------------------------------------------------------------------------
// Change Order Types (the "Category" lookup — configured like Issue Types)
// -----------------------------------------------------------------------------
export async function getChangeOrderTypes(
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

export async function getChangeOrderTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("changeOrderType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name", { ascending: true });
}

export async function getChangeOrderType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderType").select("*").eq("id", id).single();
}

export async function upsertChangeOrderType(
  client: SupabaseClient<Database>,
  changeOrderType:
    | {
        name: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      }
    | {
        id: string;
        name: string;
        updatedBy: string;
        customFields?: Json;
      }
) {
  if ("createdBy" in changeOrderType) {
    return client
      .from("changeOrderType")
      .insert([changeOrderType])
      .select("id")
      .single();
  }
  return client
    .from("changeOrderType")
    .update(sanitize(changeOrderType))
    .eq("id", changeOrderType.id)
    .select("id")
    .single();
}

export async function deleteChangeOrderType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderType").delete().eq("id", id);
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
  error: ChangeOrderError | null;
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
// same privileged method helpers — see applyChangeOrder / changeOrder.server).
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
  error: ChangeOrderError | null;
};

// Create the CO-owned Draft make method for an affected item per its change type.
export async function createChangeOrderDraftMethod(
  client: SupabaseClient<Database>,
  input: {
    changeOrderId: string;
    itemId: string;
    changeType: ChangeOrderChangeType;
    // Optional revision label for the Revision path — when the caller already
    // knows the target revision (e.g. the value typed in the new-revision
    // modal). Omitted → the next revision is auto-computed.
    revision?: string;
    companyId: string;
    userId: string;
  }
): Promise<DraftMethodResult> {
  const { changeOrderId, itemId, changeType, revision, companyId, userId } =
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
      .update({ changeOrderId })
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
      .update({ changeOrderId })
      .eq("id", newItemId)
      .eq("companyId", companyId);
    if (stampItem.error) return { data: null, error: stampItem.error };
    if (draftId) {
      await client
        .from("makeMethod")
        .update({ changeOrderId })
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
    // Net-new part — no predecessor, no supersession. addChangeOrderAffectedItem
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
        .update({ changeOrderId })
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
      requiresInspection: source.data.requiresInspection,
      thumbnailPath: source.data.thumbnailPath,
      mpn: source.data.mpn,
      active: false,
      revisionStatus: "Design",
      changeOrderId,
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
      .update({ changeOrderId })
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
async function discardChangeOrderDraft(
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
export async function addChangeOrderAffectedItem(
  client: SupabaseClient<Database>,
  input: {
    changeOrderId: string;
    // The existing affected item (Version / Revision / Replacement Part). Omitted
    // for the net-new New Part path, where `newPart` is supplied and the item is
    // minted here.
    itemId?: string;
    changeType: ChangeOrderChangeType;
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
  error: ChangeOrderError | null;
}> {
  const { changeOrderId, changeType, revision, newPart, companyId, userId } =
    input;
  let itemId = input.itemId;
  let effectiveChangeType: ChangeOrderChangeType = changeType;

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
        changeOrderId,
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
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (last.data?.sortOrder ?? -1) + 1;

  const inserted = await client
    .from("changeOrderAffectedItem")
    .insert({
      changeOrderId,
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

  const draft = await createChangeOrderDraftMethod(client, {
    changeOrderId,
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
export async function updateChangeOrderAffectedItemChangeType(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    changeType: ChangeOrderChangeType;
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: ChangeOrderError | null }> {
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

  const draft = await createChangeOrderDraftMethod(client, {
    changeOrderId: affected.data.changeOrderId,
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
  await discardChangeOrderDraft(client, previousDraft, companyId);
  return { data: { id }, error: null };
}

// Update the per-item revision cutover config (mode + dates). The existence of
// the oldRev→newRev supersession is automatic at release; this only tunes it.
export async function updateChangeOrderAffectedItemCutover(
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
export type ChangeOrderStagingItemLabel = {
  id: string;
  readableId: string;
  readableIdWithRevision: string | null;
  name: string;
  type: Database["public"]["Enums"]["itemType"];
  active: boolean;
  revisionStatus: Database["public"]["Enums"]["itemRevisionStatus"];
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
};

type ChangeOrderAffectedItemRow =
  Database["public"]["Tables"]["changeOrderAffectedItem"]["Row"];

export type ChangeOrderAffectedItemWithLabel = ChangeOrderAffectedItemRow & {
  item: ChangeOrderStagingItemLabel | null;
};

const ITEM_LABEL_COLUMNS =
  "id, readableId, readableIdWithRevision, name, type, active, revisionStatus, replenishmentSystem";

// Fetch minimal item labels for a set of ids, indexed by item id.
async function stitchItemLabels(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
): Promise<{
  labels: Map<string, ChangeOrderStagingItemLabel>;
  error: { message: string } | null;
}> {
  const uniqueIds = [...new Set(itemIds)];
  const labels = new Map<string, ChangeOrderStagingItemLabel>();
  if (uniqueIds.length === 0) return { labels, error: null };

  const items = await client
    .from("item")
    .select(ITEM_LABEL_COLUMNS)
    .in("id", uniqueIds)
    .eq("companyId", companyId);

  if (items.error) return { labels, error: items.error };
  for (const it of items.data ?? [])
    labels.set(it.id, it as ChangeOrderStagingItemLabel);

  return { labels, error: null };
}

// The affected items of a CO, each stitched to a minimal item label.
export async function getChangeOrderAffectedItems(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<{
  data: ChangeOrderAffectedItemWithLabel[];
  error: { message: string } | null;
}> {
  const affected = await client
    .from("changeOrderAffectedItem")
    .select("*")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });

  if (affected.error) return { data: [], error: affected.error };
  const rows = affected.data ?? [];
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

// Remove an affected item + discard its CO-owned Draft (delete the new item for
// Revision/New Part, or the Draft method for Version) so no orphan draft leaks.
export async function removeChangeOrderAffectedItem(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  const affected = await client
    .from("changeOrderAffectedItem")
    .select("draftMakeMethodId, newItemId")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!affected.error && affected.data) {
    await discardChangeOrderDraft(client, affected.data, companyId);
  }
  return client
    .from("changeOrderAffectedItem")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// =============================================================================
// Change Orders — item traceability reads (part/tool ↔ CO) and the linked-NCR
// reverse view. Split out of changeOrder.service.ts to keep each file focused
// and under the module's 1000-line budget (G4).
// =============================================================================

// G6 — the SINGLE canonical "change orders referencing this item" query,
// parameterized by status. The item-detail history (all COs), the open-CO alert
// (open statuses), and the single-open-CO guard all call this — no forked
// implementations. Spans every way a CO references an item in the top-to-bottom
// model: an affected item the user selected to change, a staged BOM component,
// a manual supersession (predecessor or successor), and the reverse link from a
// released revision (`item.changeOrderId`). Scoped by readableId so it matches
// the part across all its revisions. Flat queries + JS union (no embeds —
// TS2589 budget).
export type ChangeOrderForItem = {
  id: string;
  changeOrderId: string;
  name: string;
  status: Database["public"]["Enums"]["changeOrderStatus"];
  changeOrderTypeId: string | null;
  createdAt: string;
};

export async function findChangeOrdersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    statuses?: Database["public"]["Enums"]["changeOrderStatus"][];
  }
): Promise<{ data: ChangeOrderForItem[]; error: { message: string } | null }> {
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

// Reverse of the Linked-NCR cross-link (4a): every change order that references
// a given non-conformance. Read-only, minimal columns; rendered on the Issue
// detail. Flat select (no embeds — TS2589 budget).
export async function getChangeOrdersForNonConformance(
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

// Single-open-CO-per-part guard (V1 — no parallel change orders): the OTHER
// open change orders that already reference a part, excluding the current CO.
// Reuses the canonical G6 query at the open-status filter. A non-empty result
// means adding the part here would create a parallel open CO — the routes (and
// the staging service) reject it.
export async function findOtherOpenChangeOrdersForItem(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string; excludeChangeOrderId: string }
): Promise<ChangeOrderForItem[]> {
  const { data } = await findChangeOrdersForItem(client, {
    itemId: args.itemId,
    companyId: args.companyId,
    statuses: changeOrderOpenStatuses
  });
  return data.filter((co) => co.id !== args.excludeChangeOrderId);
}

// Loader data for the "Change Orders" history section + open-CO alert on an
// item detail page (part/tool/material) — the CO history for the item plus the
// type lookup used to label rows. One shared source so the detail routes don't
// each re-implement the pair of reads.
export async function getItemChangeOrderData(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [changeOrders, changeOrderTypes] = await Promise.all([
    findChangeOrdersForItem(client, { itemId, companyId }),
    getChangeOrderTypesList(client, companyId)
  ]);
  return {
    changeOrders: changeOrders.data,
    changeOrderTypes: changeOrderTypes.data ?? []
  };
}

// =============================================================================
// Change Orders — Actions (freeform tasks; reuse changeOrderActionTask). Any
// user, any stage; non-gating. Split out of changeOrder.service.ts to keep
// each file focused and under the module's 1000-line budget (G4).
// =============================================================================
export async function getChangeOrderActions(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
) {
  return client
    .from("changeOrderActionTask")
    .select("*")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function updateChangeOrderActionStatus(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    status: (typeof changeOrderTaskStatus)[number];
    userId: string;
  }
) {
  const today = new Date().toISOString().split("T")[0];
  return client
    .from("changeOrderActionTask")
    .update({
      status: input.status,
      completedDate: input.status === "Completed" ? today : null,
      updatedBy: input.userId
    })
    .eq("id", input.id)
    .select("id")
    .single();
}

export async function deleteChangeOrderAction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderActionTask").delete().eq("id", id);
}

// Bulk reorder (drag-sort) — a multi-row write, so Kysely (route passes
// getDatabaseClient()).
export async function updateChangeOrderActionOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("changeOrderActionTask")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}

// =============================================================================
// Change Order Required Actions (the configurable default-action templates the
// config CRUD page manages, and the source new change orders are seeded from).
// =============================================================================
export async function getChangeOrderRequiredActions(
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

export async function getChangeOrderRequiredActionsList(
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

export async function getChangeOrderRequiredAction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("changeOrderRequiredAction")
    .select("*")
    .eq("id", id)
    .single();
}

export async function upsertChangeOrderRequiredAction(
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

export async function deleteChangeOrderRequiredAction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderRequiredAction").delete().eq("id", id);
}

// Reconcile a change order's action tasks to a chosen set of required-action
// templates — the sidebar's editable "Required Actions" multiselect (mirrors
// Quality's requiredActionIds field). Templates newly selected are instantiated
// (appended); templates deselected have their task removed. Tasks with no
// template link (actionTypeId IS NULL) are left untouched.
export async function setChangeOrderActionTasks(
  client: SupabaseClient<Database>,
  input: {
    changeOrderId: string;
    requiredActionIds: string[];
    companyId: string;
    userId: string;
  }
) {
  const existing = await client
    .from("changeOrderActionTask")
    .select("id, actionTypeId, sortOrder")
    .eq("changeOrderId", input.changeOrderId)
    .eq("companyId", input.companyId);
  if (existing.error) return existing;

  const rows = existing.data ?? [];
  const desired = new Set(input.requiredActionIds);
  const linked = new Set(
    rows.map((r) => r.actionTypeId).filter((id): id is string => Boolean(id))
  );

  const toRemove = rows
    .filter((r) => r.actionTypeId && !desired.has(r.actionTypeId))
    .map((r) => r.id);
  if (toRemove.length > 0) {
    const del = await client
      .from("changeOrderActionTask")
      .delete()
      .in("id", toRemove);
    if (del.error) return del;
  }

  const toAddIds = input.requiredActionIds.filter((id) => !linked.has(id));
  if (toAddIds.length > 0) {
    const templates = await client
      .from("changeOrderRequiredAction")
      .select("id, name")
      .in("id", toAddIds)
      .eq("companyId", input.companyId);
    if (templates.error) return templates;

    const base = rows.reduce((max, r) => Math.max(max, r.sortOrder ?? 0), 0);
    const ins = await client.from("changeOrderActionTask").insert(
      (templates.data ?? []).map((template, index) => ({
        changeOrderId: input.changeOrderId,
        actionTypeId: template.id,
        name: template.name,
        status: "Pending" as const,
        sortOrder: base + index + 1,
        companyId: input.companyId,
        createdBy: input.userId
      }))
    );
    if (ins.error) return ins;
  }

  return { data: null, error: null };
}

// Instantiate one changeOrderActionTask per active template onto a new change
// order. Called by insertChangeOrder; non-gating, so callers ignore a soft
// failure rather than roll back the change order.
export async function seedDefaultChangeOrderActions(
  client: SupabaseClient<Database>,
  input: { changeOrderId: string; companyId: string; userId: string }
) {
  const templates = await getChangeOrderRequiredActionsList(
    client,
    input.companyId
  );
  if (templates.error || !templates.data?.length) return templates;

  return client.from("changeOrderActionTask").insert(
    templates.data.map((template, index) => ({
      changeOrderId: input.changeOrderId,
      actionTypeId: template.id,
      name: template.name,
      status: "Pending" as const,
      sortOrder: index + 1,
      companyId: input.companyId,
      createdBy: input.userId
    }))
  );
}

// =============================================================================
// Change Orders — the reusable method-diff engine (Q5 git-style end-state).
//
// `diffMethod` is a PURE function (no DB access, unit-testable): it compares two
// method snapshots (a `base` = the current live method, a `target` = the CO's
// staged desired end-state) and classifies every material / operation as
// added / removed / modified / unchanged, plus a column-by-column attribute diff.
// The same shape is reused for the pre-release "tips" (staged-vs-live) and the
// post-release oldRev↔newRev redline (Task 17).
//
// `getChangeOrderDiff` is the DB-facing wrapper: for each affected item it reads
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

// OperationChildrenDiff and OperationDiffEntry now live in changeOrder.models
// (imported + re-exported above) so ChangeOrderItemDiff can reference them
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

export type ChangeOrderDiff = {
  items: ChangeOrderItemDiff[];
};

// Editable item attribute columns compared for the attribute diff. `mpn` lives on
// item; the item group (itemPostingGroupId) lives on itemCost and is merged in
// separately by readItemAttributes. `active` is intentionally excluded — a CO
// draft is created inactive until release, so it always differs (not a real edit).
const ITEM_ATTRIBUTE_COLUMNS =
  "name, description, unitOfMeasureCode, itemTrackingType, defaultMethodType, replenishmentSystem, sourcingType, requiresInspection, thumbnailPath, mpn";

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
  "operationSupplierProcessId"
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
    operationSupplierProcessId: new Set()
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
    table: "process" | "workCenter" | "procedure",
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
    load("procedure", collected.procedureId)
  ]);
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
export async function getChangeOrderDiff(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<{ data: ChangeOrderDiff; error: { message: string } | null }> {
  const affected = await getChangeOrderAffectedItems(
    client,
    changeOrderId,
    companyId
  );
  if (affected.error) return { data: { items: [] }, error: affected.error };

  const items: ChangeOrderItemDiff[] = [];

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
