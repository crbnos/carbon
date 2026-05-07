import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type {
  ConditionAst,
  ItemRuleRow,
  Severity,
  TransactionSurface
} from "@carbon/utils";
import { getLocalTimeZone, now, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator
} from "../shared";
import {
  lookupBuyPriceFromMap,
  type PriceBreak,
  type SupplierPriceMap
} from "../shared";
import {
  type configurationParameterGroupOrderValidator,
  type configurationParameterGroupValidator,
  type configurationParameterOrderValidator,
  type configurationParameterValidator,
  type configurationRuleValidator,
  type consumableValidator,
  type customerPartValidator,
  type getMethodValidator,
  ItemTrackingType,
  type itemCostValidator,
  type itemManufacturingValidator,
  type itemPlanningValidator,
  type itemPostingGroupValidator,
  type itemPurchasingValidator,
  type itemUnitSalePriceValidator,
  type itemValidator,
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
  type partValidator,
  type pickMethodValidator,
  type serviceValidator,
  type shelfLifeModes,
  type shelfLifeTriggerTimings,
  type supplierPartValidator,
  type toolValidator,
  type unitOfMeasureValidator
} from "./items.models";
import type { InventoryItemType } from "./types";

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
      userId: args.userId
    }
  });
}

export async function createRevision(
  client: SupabaseClient<Database>,
  args: {
    item: NonNullable<Awaited<ReturnType<typeof getItem>>["data"]>;
    revision: string;
    createdBy: string;
  }
) {
  const { item, revision, createdBy } = args;
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
      active: true,
      modelUploadId: item.modelUploadId,
      companyId: item.companyId,
      createdBy: createdBy
    })
    .select("id")
    .single();

  if (itemInsert.error) {
    return itemInsert;
  }

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
    console.error(parameters.error);
    return { groups: [], parameters: [] };
  }

  if (groups.error) {
    console.error(groups.error);
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
    console.error(result.error);
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
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%`
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
    .order("postingDate", { ascending: false });
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
  return client
    .rpc("get_inventory_quantities", {
      location_id: locationId,
      company_id: companyId
    })
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
    supplierQuotes
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
      .limit(100)
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
    supplierQuotes: supplierQuotes.data ?? []
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
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%`
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
    .select("*, item(name, itemTrackingType, replenishmentSystem)")
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
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%`
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
    supplierQuotes
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
      .limit(100)
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
    supplierQuotes: supplierQuotes.data ?? []
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
    type: string | null;
    group: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("service")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%`
    );
  }

  if (args.type) {
    query = query.eq(
      "serviceType",
      args.type as NonNullable<"Internal" | "External">
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
  return client
    .from("service")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .single();
}

export async function getServicesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "item", "id, name", (query) =>
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
      `readableIdWithRevision.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%`
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
      .select("id,readableId, readableIdWithRevision")
      .eq("id", data.id)
      .single(),
    client
      .from("activeMakeMethods")
      .select("id, version")
      .eq("itemId", data.id)
      .maybeSingle()
  ]);
  if (item.error) return item;
  const readableId = item.data.readableId;
  const relatedItems = await client
    .from("item")
    .select("id")
    .eq("readableId", readableId);

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
            .where("status", "not in", ["Completed", "Closed", "Cancelled"])
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
            .where("status", "not in", ["Completed", "Closed", "Cancelled"])
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
            .where("status", "in", ["Draft", "Pending"])
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
            .where("status", "in", ["Draft", "Pending"])
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
            .where("status", "in", ["Draft", "Released", "In Progress"])
        )
      )
      .execute();
  });
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
      console.error(itemCostUpdate.error);
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
        console.error(itemCostUpdate.find((update) => update.error));
      }
    } else {
      const itemInsert = await client
        .from("item")
        .insert({
          readableId: material.id,
          name: material.name,
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
        console.error(itemCostUpdate.error);
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
    | (Omit<z.infer<typeof serviceValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in service) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: service.id,
        name: service.name,
        type: "Service",
        replenishmentSystem:
          service.serviceType === "External" ? "Buy" : "Make",
        defaultMethodType:
          service.serviceType === "External"
            ? "Purchase to Order"
            : "Make to Order",
        itemTrackingType: service.itemTrackingType,
        unitOfMeasureCode: "EA",
        active: true,
        companyId: service.companyId,
        createdBy: service.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const serviceInsert = await client
      .from("service")
      .insert({
        id: service.id,
        serviceType: service.serviceType,
        companyId: service.companyId,
        createdBy: service.createdBy,
        customFields: service.customFields
      })
      .select("*")
      .single();

    if (serviceInsert.error) return serviceInsert;

    const costUpdate = await client
      .from("itemCost")
      .update({ unitCost: service.unitCost })
      .eq("itemId", itemId)
      .select("*")
      .single();

    if (costUpdate.error) return costUpdate;

    const newService = await client
      .from("service")
      .select("*")
      .eq("readableId", service.id)
      .single();

    return newService;
  }
  const itemUpdate = {
    id: service.id,
    name: service.name,
    description: service.description,
    replenishmentSystem:
      service.serviceType === "External" ? "Buy" : ("Make" as "Buy"),
    defaultMethodType:
      service.serviceType === "External"
        ? "Purchase to Order"
        : ("Make to Order" as "Purchase to Order"),
    itemTrackingType: service.itemTrackingType,
    unitOfMeasureCode: null,
    active: true
  };

  const serviceUpdate = {
    serviceType: service.serviceType
  };

  const [updateItem, updateService] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", service.id),
    client
      .from("service")
      .update({
        ...sanitize(serviceUpdate),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("itemId", service.id)
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

// ---------------------------------------------------------------------------
// Item Rules
// ---------------------------------------------------------------------------

type ItemRuleInsert = {
  name: string;
  description?: string | null;
  message: string;
  severity: Severity;
  conditionAst: ConditionAst;
  active: boolean;
  companyId: string;
  createdBy: string;
  customFields?: Json;
};

type ItemRuleUpdate = {
  id: string;
  name: string;
  description?: string | null;
  message: string;
  severity: Severity;
  conditionAst: ConditionAst;
  active: boolean;
  updatedBy: string;
  customFields?: Json;
};

export async function getItemRules(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("itemRule")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args ?? {}, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getItemRule(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("itemRule").select("*").eq("id", id).single();
}

export async function getItemRulesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    severity: Severity;
    active: boolean;
    surfaces: TransactionSurface[];
  }>(client, "itemRule", "id, name, severity, active, surfaces", (query) =>
    query.eq("companyId", companyId).order("name")
  );
}

export async function upsertItemRule(
  client: SupabaseClient<Database>,
  rule: ItemRuleInsert | ItemRuleUpdate
) {
  if ("createdBy" in rule) {
    return client
      .from("itemRule")
      .insert({ ...rule, conditionAst: rule.conditionAst as unknown as Json })
      .select("id")
      .single();
  }
  return client
    .from("itemRule")
    .update({
      ...sanitize(rule),
      conditionAst: rule.conditionAst as unknown as Json,
      // Full timestamp (not date-only) so the LRU cache in
      // `compileWithCache` invalidates on every edit, not once per day.
      updatedAt: now(getLocalTimeZone()).toAbsoluteString()
    })
    .eq("id", rule.id)
    .select("id")
    .single();
}

export async function deleteItemRule(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("itemRule").delete().eq("id", id);
}

/**
 * Returns active rules assigned to a specific item.
 * Single JOIN — never per-row lookups.
 */
export async function getActiveRulesForItem(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<{ data: ItemRuleRow[]; error: unknown }> {
  const batched = await getActiveRulesForItems(client, [itemId], companyId);
  return { data: batched.data.get(itemId) ?? [], error: batched.error };
}

/**
 * Batched variant — single round-trip + JOIN for N items. Use this when
 * iterating over multiple items in one request (e.g. evaluating every line
 * on a receipt) to avoid the N+1 round-trips you'd get from calling
 * `getActiveRulesForItem` per item.
 */
export async function getActiveRulesForItems(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
): Promise<{ data: Map<string, ItemRuleRow[]>; error: unknown }> {
  const out = new Map<string, ItemRuleRow[]>();
  if (itemIds.length === 0) return { data: out, error: null };

  const { data, error } = await client
    .from("itemRuleAssignment")
    .select(
      `itemId, itemRule:ruleId(id, severity, message, conditionAst, surfaces, updatedAt, active)`
    )
    .in("itemId", itemIds)
    .eq("companyId", companyId);

  if (error) return { data: out, error };

  for (const r of data ?? []) {
    // supabase returns the joined row either as object or array depending on FK shape.
    // Cast through `unknown` because the generated `Database` types don't yet
    // know about the `surfaces` column (run `bun run db:types` after the
    // migration applies to refresh).
    const row = r as unknown as {
      itemId: string;
      itemRule: ItemRuleRow | ItemRuleRow[] | null;
    };
    const node = Array.isArray(row.itemRule) ? row.itemRule[0] : row.itemRule;
    if (!node || node.active === false) continue;
    const bucket = out.get(row.itemId);
    if (bucket) bucket.push(node);
    else out.set(row.itemId, [node]);
  }
  return { data: out, error: null };
}

export async function getRuleAssignmentsForItem(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemRuleAssignment")
    .select(
      `itemId, ruleId, createdAt, itemRule:ruleId(id, name, severity, message, active, surfaces)`
    )
    .eq("itemId", itemId)
    .eq("companyId", companyId);
}

export async function getRuleAssignmentCounts(
  client: SupabaseClient<Database>,
  ruleIds: string[]
) {
  if (ruleIds.length === 0) return { data: {}, error: null };
  const { data, error } = await client
    .from("itemRuleAssignment")
    .select("ruleId")
    .in("ruleId", ruleIds);
  if (error) return { data: {}, error };
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.ruleId] = (counts[row.ruleId] ?? 0) + 1;
  }
  return { data: counts, error: null };
}

export async function assignItemRule(
  client: SupabaseClient<Database>,
  args: { itemId: string; ruleId: string; companyId: string; userId: string }
) {
  return client
    .from("itemRuleAssignment")
    .insert({
      itemId: args.itemId,
      ruleId: args.ruleId,
      companyId: args.companyId,
      createdBy: args.userId
    })
    .select("itemId, ruleId")
    .single();
}

export async function unassignItemRule(
  client: SupabaseClient<Database>,
  args: { itemId: string; ruleId: string }
) {
  return client
    .from("itemRuleAssignment")
    .delete()
    .eq("itemId", args.itemId)
    .eq("ruleId", args.ruleId);
}
