import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLocalTimeZone, now, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  AuthContextHolder,
  getAuthClient,
  mcpTool
} from "~/services/mcp/index.server";
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
  getMethodValidator,
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
export const activateMethodVersion = mcpTool(
  {
    classification: "WRITE"
  },
  async function activateMethodVersion(payload: { id: string }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
    return client.functions.invoke<{ convertedId: string }>("convert", {
      body: {
        type: "methodVersionToActive",
        ...payload,
        companyId,
        userId
      }
    });
  }
);

export const copyItem = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({ args: getMethodValidator })
  },
  async function copyItem(
    args: z.infer<typeof getMethodValidator> & {
      companyId: string;
      userId: string;
    }
  ) {
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.functions.invoke("get-method", {
      body: {
        type: "itemToItem",
        sourceId: args.sourceId,
        targetId: args.targetId,
        companyId: companyId,
        userId: userId,
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
);

export const copyMakeMethod = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({ args: getMethodValidator })
  },
  async function copyMakeMethod(
    args: z.infer<typeof getMethodValidator> & {
      companyId: string;
      userId: string;
    }
  ) {
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.functions.invoke("get-method", {
      body: {
        type: "makeMethodToMakeMethod",
        sourceId: args.sourceId,
        targetId: args.targetId,
        companyId: companyId,
        userId: userId
      }
    });
  }
);

export const createRevision = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({
      args: z.object({ item: z.any(), revision: z.string() })
    })
  },
  async function createRevision(args: {
    item: NonNullable<Awaited<ReturnType<typeof getItem>>["data"]>;
    revision: string;
  }) {
    const { companyId, userId: createdBy } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    const { item, revision } = args;
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
        companyId: companyId,
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
          companyId: companyId,
          userId: createdBy
        }
      });
    }

    return itemInsert;
  }
);

export const deleteConfigurationParameter = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteConfigurationParameter(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("configurationParameter").delete().eq("id", id);
  }
);

export const deleteConfigurationRule = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteConfigurationRule(field: string, itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("configurationRule")
      .delete()
      .eq("field", field)
      .eq("itemId", itemId);
  }
);

export const deleteItemCustomerPart = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteItemCustomerPart(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("customerPartToItem")
      .delete()
      .eq("id", id)
      .eq("companyId", companyId);
  }
);

export const deleteConfigurationParameterGroup = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteConfigurationParameterGroup(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const deleteItem = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteItem(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("item").delete().eq("id", id);
  }
);

export const deleteItemPostingGroup = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteItemPostingGroup(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("itemPostingGroup").delete().eq("id", id);
  }
);

export const deleteMaterialDimension = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaterialDimension(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("materialDimension").delete().eq("id", id);
  }
);

export const deleteMaterialFinish = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaterialFinish(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("materialFinish").delete().eq("id", id);
  }
);

export const deleteMaterialForm = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaterialForm(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("materialForm").delete().eq("id", id);
  }
);

export const deleteMaterialGrade = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaterialGrade(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("materialGrade").delete().eq("id", id);
  }
);

export const deleteMaterialSubstance = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaterialSubstance(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("materialSubstance").delete().eq("id", id);
  }
);

export const deleteMethodMaterial = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMethodMaterial(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("methodMaterial").delete().eq("id", id);
  }
);

export const assertMethodOperationIsDraft = mcpTool(
  {
    classification: "WRITE"
  },
  async function assertMethodOperationIsDraft(operationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const deleteMethodOperationStep = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMethodOperationStep(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("methodOperationStep").delete().eq("id", id);
  }
);

export const deleteMethodOperationParameter = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMethodOperationParameter(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("methodOperationParameter").delete().eq("id", id);
  }
);

export const deleteMethodOperationTool = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMethodOperationTool(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("methodOperationTool").delete().eq("id", id);
  }
);

export const deleteUnitOfMeasure = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteUnitOfMeasure(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("unitOfMeasure").delete().eq("id", id);
  }
);

export const getConfigurationParameters = mcpTool(
  {
    classification: "READ"
  },
  async function getConfigurationParameters(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getConfigurationRules = mcpTool(
  {
    classification: "READ"
  },
  async function getConfigurationRules(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getConsumable = mcpTool(
  {
    classification: "READ"
  },
  async function getConsumable(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .rpc("get_consumable_details", {
        item_id: itemId
      })
      .single();
  }
);

export const getConsumables = mcpTool(
  {
    classification: "READ"
  },
  async function getConsumables(
    args: GenericQueryFilters & {
      search: string | null;
      supplierId: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getConsumablesList = mcpTool(
  {
    classification: "READ"
  },
  async function getConsumablesList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);
export const getItem = mcpTool(
  {
    classification: "READ"
  },
  async function getItem(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("item").select("*").eq("id", id).single();
  }
);

export const getItemCost = mcpTool(
  {
    classification: "READ"
  },
  async function getItemCost(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("itemCost")
      .select("*, ...item(readableIdWithRevision)")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .single();
  }
);

export const getItemCostHistory = mcpTool(
  {
    classification: "READ"
  },
  async function getItemCostHistory(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getItemCustomerPart = mcpTool(
  {
    classification: "READ"
  },
  async function getItemCustomerPart(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("customerPartToItem")
      .select("*, customer(id, name)")
      .eq("id", id)
      .eq("companyId", companyId)
      .single();
  }
);

export const getItemCustomerParts = mcpTool(
  {
    classification: "READ"
  },
  async function getItemCustomerParts(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("customerPartToItem")
      .select("*, customer(id, name)")
      .eq("itemId", itemId)
      .eq("companyId", companyId);
  }
);

export const getItemDemand = mcpTool(
  {
    classification: "READ",
    argOrder: ["args"]
  },
  async function getItemDemand({
    itemId,
    locationId,
    periods
  }: {
    itemId: string;
    locationId: string;
    periods: string[];
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getItemFiles = mcpTool(
  {
    classification: "READ"
  },
  async function getItemFiles(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    const result = await client.storage
      .from("private")
      .list(`${companyId}/parts/${itemId}`);
    return result.data || [];
  }
);

export const getItemPostingGroup = mcpTool(
  {
    classification: "READ"
  },
  async function getItemPostingGroup(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("itemPostingGroup").select("*").eq("id", id).single();
  }
);

export const getItemPostingGroups = mcpTool(
  {
    classification: "READ"
  },
  async function getItemPostingGroups(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getItemPostingGroupsList = mcpTool(
  {
    classification: "READ"
  },
  async function getItemPostingGroupsList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("itemPostingGroup")
      .select("id, name", { count: "exact" })
      .eq("companyId", companyId)
      .order("name");
  }
);

export const getItemManufacturing = mcpTool(
  {
    classification: "READ"
  },
  async function getItemManufacturing(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("itemReplenishment")
      .select("*")
      .eq("itemId", id)
      .eq("companyId", companyId)
      .single();
  }
);

export const getItemPlanning = mcpTool(
  {
    classification: "READ"
  },
  async function getItemPlanning(itemId: string, locationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("itemPlanning")
      .select("*")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .eq("locationId", locationId)
      .maybeSingle();
  }
);

export const getItemQuantities = mcpTool(
  {
    classification: "READ"
  },
  async function getItemQuantities(itemId: string, locationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .rpc("get_inventory_quantities", {
        location_id: locationId,
        company_id: companyId
      })
      .eq("id", itemId)
      .maybeSingle();
  }
);

export const getItemReplenishment = mcpTool(
  {
    classification: "READ"
  },
  async function getItemReplenishment(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("itemReplenishment")
      .select("*")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .single();
  }
);

export const getItemStorageUnitQuantities = mcpTool(
  {
    classification: "READ"
  },
  async function getItemStorageUnitQuantities(
    itemId: string,
    locationId: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client.rpc("get_item_quantities_by_tracking_id", {
      item_id: itemId,
      company_id: companyId,
      location_id: locationId
    });
  }
);

export const getItemSupply = mcpTool(
  {
    classification: "READ",
    argOrder: ["args"]
  },
  async function getItemSupply({
    itemId,
    locationId,
    periods
  }: {
    itemId: string;
    locationId: string;
    periods: string[];
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getItemUnitSalePrice = mcpTool(
  {
    classification: "READ"
  },
  async function getItemUnitSalePrice(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("itemUnitSalePrice")
      .select("*")
      .eq("itemId", id)
      .eq("companyId", companyId)
      .single();
  }
);

export const getMaterialUsedIn = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialUsedIn(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
        .select(
          "id, methodType, ...job(documentReadableId:jobId, documentId:id)"
        )
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
);

export const getMakeMethods = mcpTool(
  {
    classification: "READ"
  },
  async function getMakeMethods(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("makeMethod")
      .select("*")
      .eq("itemId", itemId)
      .eq("companyId", companyId);
  }
);

export const getMakeMethodById = mcpTool(
  {
    classification: "READ"
  },
  async function getMakeMethodById(makeMethodId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("makeMethod")
      .select("*")
      .eq("id", makeMethodId)
      .eq("companyId", companyId)
      .single();
  }
);

export const getMaterial = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterial(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .rpc("get_material_details", {
        item_id: itemId
      })
      .single();
  }
);

export const getMaterials = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterials(
    args: GenericQueryFilters & {
      search: string | null;
      supplierId: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaterialsList = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialsList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaterialDimension = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialDimension(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("materialDimension").select("*").eq("id", id).single();
  }
);

export const getMaterialDimensions = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialDimensions(
    args?: GenericQueryFilters & { search: string | null; isMetric: boolean }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaterialDimensionList = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialDimensionList(
    materialFormId: string,
    isMetric: boolean
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("materialDimension")
      .select("*")
      .eq("materialFormId", materialFormId)
      .eq("isMetric", isMetric)
      .or(`companyId.eq.${companyId},companyId.is.null`);
  }
);

export const getMaterialFinish = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialFinish(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("materialFinish").select("*").eq("id", id).single();
  }
);

export const getMaterialFinishes = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialFinishes(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaterialFinishList = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialFinishList(materialSubstanceId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("materialFinish")
      .select("*")
      .eq("materialSubstanceId", materialSubstanceId)
      .or(`companyId.eq.${companyId},companyId.is.null`);
  }
);

export const getMaterialForm = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialForm(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("materialForm").select("*").eq("id", id).single();
  }
);

export const getMaterialForms = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialForms(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaterialFormsList = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialFormsList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("materialForm")
      .select("id, name, code, companyId")
      .or(`companyId.eq.${companyId},companyId.is.null`)
      .order("name");
  }
);

export const getMaterialGrades = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialGrades(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaterialGrade = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialGrade(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("materialGrade").select("*").eq("id", id).single();
  }
);

export const getMaterialGradeList = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialGradeList(materialSubstanceId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("materialGrade")
      .select("*")
      .eq("materialSubstanceId", materialSubstanceId)
      .or(`companyId.eq.${companyId},companyId.is.null`);
  }
);

export const getMaterialSubstance = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialSubstance(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("materialSubstance").select("*").eq("id", id).single();
  }
);

export const getMaterialSubstances = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialSubstances(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaterialSubstancesList = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialSubstancesList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("materialSubstance")
      .select("id, name, code, companyId")
      .or(`companyId.eq.${companyId},companyId.is.null`)
      .order("name");
  }
);

export const getMethodMaterial = mcpTool(
  {
    classification: "READ"
  },
  async function getMethodMaterial(materialId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("methodMaterial")
      .select("*, item(name)")
      .eq("id", materialId)
      .single();
  }
);

export const getMethodMaterials = mcpTool(
  {
    classification: "READ"
  },
  async function getMethodMaterials(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMethodMaterialsByMakeMethod = mcpTool(
  {
    classification: "READ"
  },
  async function getMethodMaterialsByMakeMethod(makeMethodId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("methodMaterial")
      .select("*, item(name, itemTrackingType, replenishmentSystem)")
      .eq("makeMethodId", makeMethodId)
      .order("order", { ascending: true });
  }
);

export const getMethodOperations = mcpTool(
  {
    classification: "READ"
  },
  async function getMethodOperations(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMethodOperationsByMakeMethodId = mcpTool(
  {
    classification: "READ"
  },
  async function getMethodOperationsByMakeMethodId(makeMethodId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("methodOperation")
      .select(
        "*, methodOperationTool(*), methodOperationParameter(*), methodOperationStep(*)"
      )
      .eq("makeMethodId", makeMethodId)
      .order("order", { ascending: true });
  }
);

type Method = NonNullable<
  Awaited<ReturnType<typeof getMethodTreeArray>>["data"]
>[number];
type MethodTreeItem = {
  id: string;
  data: Method;
  children: MethodTreeItem[];
};

export const getMethodTree = mcpTool(
  {
    classification: "READ"
  },
  async function getMethodTree(makeMethodId: string) {
    const items = await getMethodTreeArray(makeMethodId);
    if (items.error) return items;

    const tree = getMethodTreeArrayToTree(items.data);

    return {
      data: tree,
      error: null
    };
  }
);

export const getMethodTreeArray = mcpTool(
  {
    classification: "READ"
  },
  async function getMethodTreeArray(makeMethodId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.rpc("get_method_tree", {
      uid: makeMethodId
    });
  }
);

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

export const getOpenJobMaterials = mcpTool(
  {
    classification: "READ",
    argOrder: ["args"]
  },
  async function getOpenJobMaterials({
    itemId,
    locationId
  }: {
    itemId: string;
    locationId: string;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("openJobMaterialLines")
      .select(
        "id, parentMaterialId, jobMakeMethodId, jobId, quantity:quantityToIssue, documentReadableId:jobReadableId, documentId:jobId, dueDate"
      )
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId);
  }
);

export const getOpenProductionOrders = mcpTool(
  {
    classification: "READ",
    argOrder: ["args"]
  },
  async function getOpenProductionOrders({
    itemId,
    locationId
  }: {
    itemId: string;
    locationId: string;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("openProductionOrders")
      .select(
        "id, quantity:quantityToReceive, documentReadableId:jobId, documentId:id, dueDate"
      )
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId);
  }
);

export const getOpenPurchaseOrderLines = mcpTool(
  {
    classification: "READ",
    argOrder: ["args"]
  },
  async function getOpenPurchaseOrderLines({
    itemId,
    locationId
  }: {
    itemId: string;
    locationId: string;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("openPurchaseOrderLines")
      .select(
        "id, quantity:quantityToReceive, dueDate:promisedDate, ...purchaseOrder(documentReadableId:purchaseOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId);
  }
);

export const getOpenSalesOrderLines = mcpTool(
  {
    classification: "READ",
    argOrder: ["args"]
  },
  async function getOpenSalesOrderLines({
    itemId,
    locationId
  }: {
    itemId: string;
    locationId: string;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("openSalesOrderLines")
      .select(
        "id, quantity:quantityToSend, dueDate:promisedDate, ...salesOrder(documentReadableId:salesOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .eq("locationId", locationId);
  }
);

export const getPart = mcpTool(
  {
    classification: "READ"
  },
  async function getPart(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .rpc("get_part_details", {
        item_id: itemId
      })
      .single();
  }
);

export const getParts = mcpTool(
  {
    classification: "READ"
  },
  async function getParts(
    args: GenericQueryFilters & {
      search: string | null;
      supplierId: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getPartsList = mcpTool(
  {
    classification: "READ"
  },
  async function getPartsList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getPartUsedIn = mcpTool(
  {
    classification: "READ"
  },
  async function getPartUsedIn(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
        .select(
          "id, methodType, ...job(documentReadableId:jobId, documentId:id)"
        )
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
);

export const getPickMethod = mcpTool(
  {
    classification: "READ"
  },
  async function getPickMethod(itemId: string, locationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("pickMethod")
      .select("*")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .eq("locationId", locationId)
      .maybeSingle();
  }
);

export const getPickMethods = mcpTool(
  {
    classification: "READ"
  },
  async function getPickMethods(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("pickMethod")
      .select("*")
      .eq("itemId", itemId)
      .eq("companyId", companyId);
  }
);

export const getServices = mcpTool(
  {
    classification: "READ"
  },
  async function getServices(
    args: GenericQueryFilters & {
      search: string | null;
      type: string | null;
      group: string | null;
      supplierId: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getService = mcpTool(
  {
    classification: "READ"
  },
  async function getService(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("service")
      .select("*")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .single();
  }
);

export const getServicesList = mcpTool(
  {
    classification: "READ"
  },
  async function getServicesList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getSupplierParts = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierParts(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("supplierPart")
      .select("*")
      .eq("active", true)
      .eq("itemId", id)
      .eq("companyId", companyId);
  }
);

export const getTool = mcpTool(
  {
    classification: "READ"
  },
  async function getTool(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .rpc("get_tool_details", {
        item_id: itemId
      })
      .single();
  }
);

export const getTools = mcpTool(
  {
    classification: "READ"
  },
  async function getTools(
    args: GenericQueryFilters & {
      search: string | null;
      supplierId: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getToolsList = mcpTool(
  {
    classification: "READ"
  },
  async function getToolsList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getUnitOfMeasure = mcpTool(
  {
    classification: "READ"
  },
  async function getUnitOfMeasure(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("unitOfMeasure")
      .select("*")
      .eq("id", id)
      .eq("companyId", companyId)
      .single();
  }
);

export const getUnitOfMeasures = mcpTool(
  {
    classification: "READ"
  },
  async function getUnitOfMeasures(
    args: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("unitOfMeasure")
      .select("*", {
        count: "exact"
      })
      .eq("companyId", companyId);

    if (args.search) {
      query = query.or(
        `name.ilike.%${args.search}%,code.ilike.%${args.search}%`
      );
    }

    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
    return query;
  }
);

export const getUnitOfMeasuresList = mcpTool(
  {
    classification: "READ"
  },
  async function getUnitOfMeasuresList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("unitOfMeasure")
      .select("name, code")
      .eq("companyId", companyId)
      .order("name");
  }
);

export const updateConfigurationParameterGroupOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateConfigurationParameterGroupOrder(
    data: z.infer<typeof configurationParameterGroupOrderValidator>
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("configurationParameterGroup")
      .update(sanitize(data))
      .eq("id", data.id);
  }
);

export const updateDefaultRevision = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateDefaultRevision(data: { id: string }) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const updateConfigurationParameterOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateConfigurationParameterOrder(
    data: Omit<
      z.infer<typeof configurationParameterOrderValidator>,
      "configurationParameterGroupId"
    > & {
      configurationParameterGroupId?: string | null;
      updatedBy: string;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("configurationParameter")
      .update(sanitize(data))
      .eq("id", data.id);
  }
);

export const updateItemCost = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateItemCost(
    itemId: string,
    cost: {
      unitCost: number;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const updateMaterialOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateMaterialOrder(
    updates: {
      id: string;
      order: number;
      updatedBy: string;
    }[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const updatePromises = updates.map(({ id, order, updatedBy }) =>
      client.from("methodMaterial").update({ order, updatedBy }).eq("id", id)
    );
    return Promise.all(updatePromises);
  }
);

export const updateOperationOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateOperationOrder(
    updates: {
      id: string;
      order: number;
      updatedBy: string;
    }[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const updatePromises = updates.map(({ id, order, updatedBy }) =>
      client.from("methodOperation").update({ order, updatedBy }).eq("id", id)
    );
    return Promise.all(updatePromises);
  }
);

export const updateRevision = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateRevision(revision: { id: string; revision: string }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("item")
      .update({
        ...revision,
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", revision.id);
  }
);

export const upsertConfigurationParameter = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertConfigurationParameter(
    configurationParameter: z.infer<typeof configurationParameterValidator> & {
      companyId: string;
      userId: string;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
          companyId: companyId
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
);

export const upsertConfigurationParameterGroup = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertConfigurationParameterGroup(
    configurationParameterGroup: z.infer<
      typeof configurationParameterGroupValidator
    > & {
      companyId: string;
      itemId: string;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertConfigurationRule = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertConfigurationRule(
    configurationRule: z.infer<typeof configurationRuleValidator> & {
      itemId: string;
      companyId: string;
      updatedBy: string;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("configurationRule").upsert(configurationRule, {
      onConflict: "itemId,field"
    });
  }
);

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
export async function upsertItemDefaultPickMethod(args: {
  itemId: string;
  storageUnitId?: string;
}) {
  const { userId } = AuthContextHolder.get();
  const client = getAuthClient<SupabaseClient<Database>>();
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
      createdBy: userId,
      updatedBy: userId,
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
export async function getRecipeProcessIdsForItem(itemId: string) {
  const client = getAuthClient<SupabaseClient<Database>>();
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
export async function getItemShelfLife(itemId: string) {
  const client = getAuthClient<SupabaseClient<Database>>();
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
  itemId: string
): Promise<boolean> {
  const client = getAuthClient<SupabaseClient<Database>>();
  const makeMethods = await getMakeMethods(itemId);
  if (makeMethods.error || !makeMethods.data?.length) return false;

  const active =
    makeMethods.data.find((m) => m.status === "Active") ?? makeMethods.data[0];

  const materials = await getMethodMaterialsByMakeMethod(active.id);
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

export async function upsertItemShelfLife(args: {
  itemId: string;
  mode?: (typeof shelfLifeModes)[number];
  days?: number;
  triggerProcessId?: string;
  triggerTiming?: (typeof shelfLifeTriggerTimings)[number];
  calculateFromBom?: boolean;
}) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { userId, companyId: authCompanyId } = AuthContextHolder.get();
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
    const recipe = await getRecipeProcessIdsForItem(args.itemId);
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
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("itemId", args.itemId);
  }

  let companyId: string | undefined = authCompanyId;
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
    createdBy: userId
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
  const { userId } = AuthContextHolder.get();
  const updatedAt = now(getLocalTimeZone()).toAbsoluteString();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("pickMethod")
      .set({
        defaultStorageUnitId: args.defaultStorageUnitId ?? null,
        customFields: args.customFields ?? null,
        updatedBy: userId,
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
          updatedBy: userId,
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
        createdBy: userId
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
  const { companyId, userId } = AuthContextHolder.get();
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
        updatedBy: userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb(
          "jobId",
          "in",
          eb
            .selectFrom("job")
            .select("id")
            .where("companyId", "=", companyId)
            .where("status", "in", ["Draft", "Planned"])
        )
      )
      .execute();

    await trx
      .updateTable("jobMaterial")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb(
          "jobId",
          "in",
          eb
            .selectFrom("job")
            .select("id")
            .where("companyId", "=", companyId)
            .where("status", "in", ["Draft", "Planned"])
        )
      )
      .execute();

    await trx
      .updateTable("receiptLine")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb(
          "receiptId",
          "in",
          eb
            .selectFrom("receipt")
            .select("id")
            .where("companyId", "=", companyId)
            .where("status", "=", "Draft")
        )
      )
      .execute();

    await trx
      .updateTable("shipmentLine")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb(
          "shipmentId",
          "in",
          eb
            .selectFrom("shipment")
            .select("id")
            .where("companyId", "=", companyId)
            .where("status", "=", "Draft")
        )
      )
      .execute();

    await trx
      .updateTable("stockTransferLine")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb(
          "stockTransferId",
          "in",
          eb
            .selectFrom("stockTransfer")
            .select("id")
            .where("companyId", "=", companyId)
            .where("status", "=", "Draft")
        )
      )
      .execute();
  });
}

export const upsertConsumable = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertConsumable(
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
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
          companyId: companyId,
          createdBy: userId
        })
        .select("id")
        .single();
      if (itemInsert.error) return itemInsert;
      const itemId = itemInsert.data?.id;

      const [consumableInsert, itemCostUpdate] = await Promise.all([
        client.from("consumable").upsert({
          id: consumable.id,
          companyId: companyId,
          createdBy: userId,
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
        const pickMethod = await upsertItemDefaultPickMethod({
          itemId,
          storageUnitId: consumable.defaultStorageUnitId
        });
        if (pickMethod.error) return pickMethod;

        const shelfLife = await upsertItemShelfLife({
          itemId,
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
        .eq("companyId", companyId)
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

    const pickMethod = await upsertItemDefaultPickMethod({
      itemId: consumable.id,
      storageUnitId: consumable.defaultStorageUnitId
    });
    if (pickMethod.error) return pickMethod;

    const shelfLife = await upsertItemShelfLife({
      itemId: consumable.id,
      mode: consumable.shelfLifeMode,
      days: consumable.shelfLifeDays,
      triggerProcessId: consumable.shelfLifeTriggerProcessId,
      triggerTiming: consumable.shelfLifeTriggerTiming,
      calculateFromBom: consumable.shelfLifeCalculateFromBom
    });
    if (shelfLife.error) return shelfLife;

    return updateConsumable;
  }
);

export const upsertPart = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPart(
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
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
          companyId: companyId,
          createdBy: userId
        })
        .select("id")
        .single();
      if (itemInsert.error) return itemInsert;
      const itemId = itemInsert.data?.id;

      const [partInsert, itemCostUpdate] = await Promise.all([
        client.from("part").upsert({
          id: part.id,
          companyId: companyId,
          createdBy: userId,
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
        const pickMethod = await upsertItemDefaultPickMethod({
          itemId,
          storageUnitId: part.defaultStorageUnitId
        });
        if (pickMethod.error) return pickMethod;

        const shelfLife = await upsertItemShelfLife({
          itemId,
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
        .eq("companyId", companyId)
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

    const pickMethod = await upsertItemDefaultPickMethod({
      itemId: part.id,
      storageUnitId: part.defaultStorageUnitId
    });
    if (pickMethod.error) return pickMethod;

    const shelfLife = await upsertItemShelfLife({
      itemId: part.id,
      mode: part.shelfLifeMode,
      days: part.shelfLifeDays,
      triggerProcessId: part.shelfLifeTriggerProcessId,
      triggerTiming: part.shelfLifeTriggerTiming,
      calculateFromBom: part.shelfLifeCalculateFromBom
    });
    if (shelfLife.error) return shelfLife;

    return updatePart;
  }
);

export const updateItem = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateItem(
    item: z.infer<typeof itemValidator> & {
      companyId: string;
      type: Database["public"]["Enums"]["itemType"];
    }
  ) {
    const { companyId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("item")
      .update(sanitize(item))
      .eq("id", item.id)
      .eq("companyId", companyId);
  }
);

export const upsertItemCost = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertItemCost(
    itemCost: z.infer<typeof itemCostValidator> & {
      updatedBy: string;
      customFields?: Json;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("itemCost")
      .update(sanitize(itemCost))
      .eq("itemId", itemCost.itemId);
  }
);

export const upsertPickMethod = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPickMethod(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertItemManufacturing = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertItemManufacturing(
    partManufacturing: z.infer<typeof itemManufacturingValidator> & {
      updatedBy: string;
      customFields?: Json;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("itemReplenishment")
      .update(sanitize(partManufacturing))
      .eq("itemId", partManufacturing.itemId);
  }
);

export const upsertItemPlanning = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertItemPlanning(
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
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("createdBy" in partPlanning) {
      return client.from("itemPlanning").insert(partPlanning);
    }
    return client
      .from("itemPlanning")
      .update(sanitize(partPlanning))
      .eq("itemId", partPlanning.itemId)
      .eq("locationId", partPlanning.locationId);
  }
);

export const upsertItemPurchasing = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertItemPurchasing(
    itemPurchasing: z.infer<typeof itemPurchasingValidator> & {
      updatedBy: string;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("itemReplenishment")
      .update(sanitize(itemPurchasing))
      .eq("itemId", itemPurchasing.itemId);
  }
);

export const upsertItemPostingGroup = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertItemPostingGroup(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertSupplierPart = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertSupplierPart(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertItemCustomerPart = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertItemCustomerPart(
    customerPart:
      | (Omit<z.infer<typeof customerPartValidator>, "id"> & {
          companyId: string;
        })
      | (Omit<z.infer<typeof customerPartValidator>, "id"> & {
          id: string;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertItemUnitSalePrice = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertItemUnitSalePrice(
    itemUnitSalePrice: z.infer<typeof itemUnitSalePriceValidator> & {
      updatedBy: string;
      customFields?: Json;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("itemUnitSalePrice")
      .update(sanitize(itemUnitSalePrice))
      .eq("itemId", itemUnitSalePrice.itemId);
  }
);

export const upsertMakeMethodVersion = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMakeMethodVersion(
    makeMethodVersion: z.infer<typeof makeMethodVersionValidator> & {
      companyId: string;
      createdBy: string;
    }
  ) {
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    const currentMakeMethod = await client
      .from("makeMethod")
      .select("*")
      .eq("id", makeMethodVersion.copyFromId)
      .eq("companyId", companyId)
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
        createdBy: userId
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
);

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
async function resolveMethodMaterialStorageUnitIds(args: {
  itemId?: string | null;
  current?: Record<string, string>;
}): Promise<Record<string, string>> {
  const client = getAuthClient<SupabaseClient<Database>>();
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

export const upsertMethodMaterial = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMethodMaterial(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
      const seededStorageUnitIds = await resolveMethodMaterialStorageUnitIds({
        itemId: methodMaterial.itemId,
        current: methodMaterial.storageUnitIds as
          | Record<string, string>
          | undefined
      });
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
);

export const upsertMethodOperation = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMethodOperation(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMethodOperationStep = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMethodOperationStep(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMethodOperationParameter = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMethodOperationParameter(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMethodOperationTool = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMethodOperationTool(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaterial = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaterial(
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
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
                companyId: companyId,
                createdBy: userId
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
            companyId: companyId,
            createdBy: userId
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
        const pickMethod = await upsertItemDefaultPickMethod({
          itemId,
          storageUnitId: material.defaultStorageUnitId
        });
        if (pickMethod.error) return pickMethod;

        const shelfLife = await upsertItemShelfLife({
          itemId,
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
        companyId: companyId,
        createdBy: userId,
        customFields: material.customFields
      });

      if (materialInsert.error) return materialInsert;

      const newMaterial = await client
        .from("materials")
        .select("*")
        .eq("readableId", material.id)
        .eq("companyId", companyId);

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

    const pickMethod = await upsertItemDefaultPickMethod({
      itemId: material.id,
      storageUnitId: material.defaultStorageUnitId
    });
    if (pickMethod.error) return pickMethod;

    const shelfLife = await upsertItemShelfLife({
      itemId: material.id,
      mode: material.shelfLifeMode,
      days: material.shelfLifeDays,
      triggerProcessId: material.shelfLifeTriggerProcessId,
      triggerTiming: material.shelfLifeTriggerTiming,
      calculateFromBom: material.shelfLifeCalculateFromBom
    });
    if (shelfLife.error) return shelfLife;

    return updateMaterial;
  }
);

export const upsertMaterialDimension = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaterialDimension(
    materialDimension:
      | (Omit<z.infer<typeof materialDimensionValidator>, "id"> & {
          companyId: string;
          isMetric: boolean;
        })
      | (Omit<z.infer<typeof materialDimensionValidator>, "id"> & {
          id: string;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaterialFinish = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaterialFinish(
    materialFinish:
      | (Omit<z.infer<typeof materialFinishValidator>, "id"> & {
          companyId: string;
        })
      | (Omit<z.infer<typeof materialFinishValidator>, "id"> & {
          id: string;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaterialForm = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaterialForm(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaterialGrade = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaterialGrade(
    materialGrade:
      | (Omit<z.infer<typeof materialGradeValidator>, "id"> & {
          companyId: string;
        })
      | (Omit<z.infer<typeof materialGradeValidator>, "id"> & {
          id: string;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const deleteMaterialType = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaterialType(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("materialType").delete().eq("id", id);
  }
);

export const getMaterialTypes = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialTypes(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaterialType = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialType(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("materialType").select("*").eq("id", id).single();
  }
);

export const getMaterialTypeList = mcpTool(
  {
    classification: "READ"
  },
  async function getMaterialTypeList(
    materialSubstanceId: string,
    materialFormId: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("materialType")
      .select("*")
      .eq("materialSubstanceId", materialSubstanceId)
      .eq("materialFormId", materialFormId)
      .or(`companyId.eq.${companyId},companyId.is.null`);
  }
);

export const upsertMaterialType = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaterialType(
    materialType:
      | (Omit<z.infer<typeof materialTypeValidator>, "id"> & {
          companyId: string;
        })
      | (Omit<z.infer<typeof materialTypeValidator>, "id"> & {
          id: string;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaterialSubstance = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaterialSubstance(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertService = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertService(
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
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
          companyId: companyId,
          createdBy: userId
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
          companyId: companyId,
          createdBy: userId,
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
);

export const upsertUnitOfMeasure = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertUnitOfMeasure(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertTool = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertTool(
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
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
          companyId: companyId,
          createdBy: userId
        })
        .select("id")
        .single();
      if (itemInsert.error) return itemInsert;
      const itemId = itemInsert.data?.id;

      const [toolInsert, itemCostUpdate] = await Promise.all([
        client.from("tool").upsert({
          id: tool.id,
          companyId: companyId,
          createdBy: userId,
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
        const pickMethod = await upsertItemDefaultPickMethod({
          itemId,
          storageUnitId: tool.defaultStorageUnitId
        });
        if (pickMethod.error) return pickMethod;

        const shelfLife = await upsertItemShelfLife({
          itemId,
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
        .eq("companyId", companyId)
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

    const pickMethod = await upsertItemDefaultPickMethod({
      itemId: tool.id,
      storageUnitId: tool.defaultStorageUnitId
    });
    if (pickMethod.error) return pickMethod;

    const shelfLife = await upsertItemShelfLife({
      itemId: tool.id,
      mode: tool.shelfLifeMode,
      days: tool.shelfLifeDays,
      triggerProcessId: tool.shelfLifeTriggerProcessId,
      triggerTiming: tool.shelfLifeTriggerTiming,
      calculateFromBom: tool.shelfLifeCalculateFromBom
    });
    if (shelfLife.error) return shelfLife;

    return updateTool;
  }
);

/**
 * Batch pre-fetch supplier price breaks for multiple items.
 * Builds a SupplierPriceMap keyed by itemId, pooling price break
 * tiers from ALL suppliers for each item.
 *
 * Used by the quote loader to pre-load pricing data for BOM costing.
 */
export const getSupplierPriceBreaksForItems = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierPriceBreaksForItems(
    itemIds: string[]
  ): Promise<SupplierPriceMap> {
    const client = getAuthClient<SupabaseClient<Database>>();
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
      if (
        sp.unitPrice != null &&
        (current === null || sp.unitPrice < current)
      ) {
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
);

/**
 * Async price lookup across ALL suppliers for an item.
 * Delegates to getSupplierPriceBreaksForItems + lookupBuyPriceFromMap.
 *
 * Used in quote creation where the specific supplier isn't known.
 */
export const lookupBuyPrice = mcpTool(
  {
    classification: "WRITE"
  },
  async function lookupBuyPrice(
    itemId: string,
    qty: number,
    fallbackCost: number
  ): Promise<number> {
    const map = await getSupplierPriceBreaksForItems([itemId]);
    return lookupBuyPriceFromMap(itemId, qty, map, fallbackCost);
  }
);

/**
 * Fetch price breaks array for a specific supplier part.
 * Used by PO and Invoice forms to cache breaks in state.
 */
export const getSupplierPartPriceBreaks = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierPartPriceBreaks(
    supplierPartId: string
  ): Promise<PriceBreak[]> {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);
