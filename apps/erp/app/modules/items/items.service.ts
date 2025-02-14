import type { Database, Json } from "@carbon/database";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { type z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type { operationToolValidator } from "../shared";
import type {
  configurationParameterGroupOrderValidator,
  configurationParameterGroupValidator,
  configurationParameterOrderValidator,
  configurationParameterValidator,
  configurationRuleValidator,
  consumableValidator,
  customerPartValidator,
  getMethodValidator,
  itemCostValidator,
  itemPlanningValidator,
  itemPostingGroupValidator,
  itemPurchasingValidator,
  itemUnitSalePriceValidator,
  itemValidator,
  materialFormValidator,
  materialSubstanceValidator,
  materialValidator,
  methodMaterialValidator,
  methodOperationValidator,
  partManufacturingValidator,
  partValidator,
  pickMethodValidator,
  serviceValidator,
  supplierPartValidator,
  toolValidator,
  unitOfMeasureValidator,
} from "./items.models";

export async function copyMakeMethod(
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
    },
  });
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
  const [itemDelete, searchDelete] = await Promise.all([
    client.from("item").delete().eq("id", id),
    client.from("search").delete().eq("uuid", id),
  ]);

  if (searchDelete.error) {
    return searchDelete;
  }

  return itemDelete;
}

export async function deleteItemPostingGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("itemPostingGroup").delete().eq("id", id);
}

export async function deleteMaterialForm(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialForm").delete().eq("id", id);
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
      .eq("companyId", companyId),
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
    .from("consumables")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
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
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `id.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "id", ascending: true },
  ]);
  return query;
}

export async function getConsumablesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  let query = client
    .from("item")
    .select("id, name, readableId")
    .eq("type", "Consumable")
    .eq("companyId", companyId)
    .eq("active", true);

  return query.order("name");
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
    .select("*, ...item(readableId)")
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
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true },
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
      company_id: companyId,
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

export async function getItemShelfQuantities(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client.rpc("get_item_quantities_by_shelf_batch_serial", {
    item_id: itemId,
    company_id: companyId,
    location_id: locationId,
  });
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
    jobMaterials,
    methodMaterials,
    purchaseOrderLines,
    receiptLines,
    quoteMaterials,
    salesOrderLines,
    shipmentLines,
  ] = await Promise.all([
    client
      .from("jobMaterial")
      .select("id, methodType, ...job(documentReadableId:jobId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("methodMaterial")
      .select(
        "id, methodType, ...makeMethod!makeMethodId(...item(documentReadableId:readableId, documentId:id, itemType:type))"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("purchaseOrderLine")
      .select(
        "id, ...purchaseOrder(documentReadableId:purchaseOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("receiptLine")
      .select("id, ...receipt(documentReadableId:receiptId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("quoteMaterial")
      .select(
        "id, methodType, documentParentId:quoteId, documentId:quoteLineId, ...quoteLine(documentReadableId:itemReadableId)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("salesOrderLine")
      .select(
        "id, methodType, ...salesOrder(documentReadableId:salesOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("shipmentLine")
      .select("id, ...shipment(documentReadableId:shipmentId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
  ]);

  return {
    jobMaterials: jobMaterials.data ?? [],
    methodMaterials: methodMaterials.data ?? [],
    purchaseOrderLines: purchaseOrderLines.data ?? [],
    receiptLines: receiptLines.data ?? [],
    quoteMaterials: quoteMaterials.data ?? [],
    salesOrderLines: salesOrderLines.data ?? [],
    shipmentLines: shipmentLines.data ?? [],
  };
}

export async function getPartUsedIn(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [
    jobMaterials,
    jobs,
    methodMaterials,
    purchaseOrderLines,
    receiptLines,
    quoteLines,
    quoteMaterials,
    salesOrderLines,
    shipmentLines,
  ] = await Promise.all([
    client
      .from("jobMaterial")
      .select("id, methodType, ...job(documentReadableId:jobId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("job")
      .select("id, documentReadableId:jobId")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("methodMaterial")
      .select(
        "id, methodType, ...makeMethod!makeMethodId(...item(documentReadableId:readableId, documentId:id, itemType:type))"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("purchaseOrderLine")
      .select(
        "id, ...purchaseOrder(documentReadableId:purchaseOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("receiptLine")
      .select("id, ...receipt(documentReadableId:receiptId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("quoteLine")
      .select(
        "id, methodType, ...quote(documentReadableId:quoteId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("quoteMaterial")
      .select(
        "id, methodType, documentParentId:quoteId, documentId:quoteLineId, ...quoteLine(documentReadableId:itemReadableId)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("salesOrderLine")
      .select(
        "id, methodType, ...salesOrder(documentReadableId:salesOrderId, documentId:id)"
      )
      .eq("itemId", itemId)
      .eq("companyId", companyId),
    client
      .from("shipmentLine")
      .select("id, ...shipment(documentReadableId:shipmentId, documentId:id)")
      .eq("itemId", itemId)
      .eq("companyId", companyId),
  ]);

  return {
    jobMaterials: jobMaterials.data ?? [],
    jobs: jobs.data ?? [],
    methodMaterials: methodMaterials.data ?? [],
    purchaseOrderLines: purchaseOrderLines.data ?? [],
    receiptLines: receiptLines.data ?? [],
    quoteLines: quoteLines.data ?? [],
    quoteMaterials: quoteMaterials.data ?? [],
    salesOrderLines: salesOrderLines.data ?? [],
    shipmentLines: shipmentLines.data ?? [],
  };
}

export async function getMakeMethod(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("makeMethod")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .single();
}

export async function getMaterial(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("materials")
    .select("*")
    .eq("itemId", itemId)
    .or(`companyId.eq.${companyId},companyId.is.null`)
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
      count: "exact",
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args.search) {
    query = query.or(
      `id.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "id", ascending: true },
  ]);
  return query;
}

export async function getMaterialsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  let query = client
    .from("item")
    .select("id, name, readableId")
    .eq("type", "Material")
    .or(`companyId.eq.${companyId},companyId.is.null`)
    .eq("active", true);

  return query.order("name");
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
      count: "exact",
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true },
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
    .select("id, name")
    .or(`companyId.eq.${companyId},companyId.is.null`)
    .order("name");
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
      count: "exact",
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true },
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
    .select("id, name")
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
      "*, item(name, readableId), makeMethod!makeMethodId(item(id, type, name, readableId))",
      {
        count: "exact",
      }
    )
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("itemReadableId", `%${args.search}%`);
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
    .select("*, item(name)")
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
    .select("*, makeMethod!makeMethodId(item(id, type, name, readableId))", {
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("description", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "order", ascending: true },
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
      "*, methodOperationTool(id, operationId, toolId, quantity, createdBy, createdAt, updatedBy, updatedAt)"
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
    error: null,
  };
}

export async function getMethodTreeArray(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  return client.rpc("get_method_tree", {
    uid: makeMethodId,
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

    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-ignore
        lookup[parentId] = { id: parentId, children: [] };
      }

      lookup[parentId]["children"].push(treeItem);
    }
  }

  return rootItems.map((item) => traverseAndRenameIds(item));
}

export async function getPart(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("parts")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
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
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `id.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "id", ascending: true },
  ]);
  return query;
}

export async function getPartsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  let query = client
    .from("item")
    .select("id, name, readableId")
    .eq("type", "Part")
    .eq("companyId", companyId)
    .eq("active", true);

  return query.order("name");
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
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,description.ilike.%${args.search}%`
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
    { column: "id", ascending: true },
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
  let query = client
    .from("item")
    .select("id, name")
    .eq("type", "Service")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");

  return query;
}

export async function getSupplierParts(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("supplierPart")
    .select(
      `
      id, supplier(id, name),
      supplierPartId, supplierUnitOfMeasureCode,
      minimumOrderQuantity, conversionFactor,
      unitPrice,
      customFields
    `
    )
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
    .from("tools")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
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
      count: "exact",
    })
    .eq("companyId", companyId);

  const includeInactive = args?.filters?.some(
    (filter) =>
      (filter.column === "active" && filter.value === "false") ||
      (filter.column === "active" && filter.operator === "in")
  );
  if (!includeInactive) {
    query = query.eq("active", true);
  }

  if (args.search) {
    query = query.or(
      `id.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%,supplierIds.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.contains("supplierIds", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "id", ascending: true },
  ]);
  return query;
}

export async function getToolsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  let query = client
    .from("item")
    .select("id, name, readableId")
    .eq("type", "Tool")
    .eq("companyId", companyId)
    .eq("active", true);

  return query.order("name");
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
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(`name.ilike.%${args.search}%,code.ilike.%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true },
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
      updatedAt: today(getLocalTimeZone()).toString(),
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
          updatedAt: new Date().toISOString(),
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
        companyId: data.companyId,
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
    configurationParameterGroupId: ungroupedGroupId,
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
        name: data.name,
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
    sortOrder: maxSortOrder + 1,
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
    onConflict: "itemId,field",
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
        active: consumable.active,
        companyId: consumable.companyId,
        createdBy: consumable.createdBy,
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const consumableInsert = await client
      .from("consumable")
      .insert({
        id: consumable.id,
        itemId: itemId,
        companyId: consumable.companyId,
        createdBy: consumable.createdBy,
        customFields: consumable.customFields,
      })
      .select("*")
      .single();

    if (consumableInsert.error) return consumableInsert;

    const costUpdate = await client
      .from("itemCost")
      .update({ unitCost: consumable.unitCost })
      .eq("itemId", itemId)
      .select("*")
      .single();

    if (costUpdate.error) return costUpdate;

    return consumableInsert;
  }

  const itemUpdate = {
    id: consumable.id,
    name: consumable.name,
    description: consumable.description,
    replenishmentSystem: consumable.replenishmentSystem,
    defaultMethodType: consumable.defaultMethodType,
    itemTrackingType: consumable.itemTrackingType,
    unitOfMeasureCode: consumable.unitOfMeasureCode,
    active: consumable.active,
  };

  const consumableUpdate = {
    customFields: consumable.customFields,
  };

  const [updateItem, updateConsumable] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("id", consumable.id),
    client
      .from("consumable")
      .update({
        ...sanitize(consumableUpdate),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("itemId", consumable.id),
  ]);

  if (updateItem.error) return updateItem;
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
        name: part.name,
        type: "Part",
        replenishmentSystem: part.replenishmentSystem,
        defaultMethodType: part.defaultMethodType,
        itemTrackingType: part.itemTrackingType,
        unitOfMeasureCode: part.unitOfMeasureCode,
        active: part.active,
        modelUploadId: part.modelUploadId,
        companyId: part.companyId,
        createdBy: part.createdBy,
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const partInsert = await client
      .from("part")
      .insert({
        id: part.id,
        itemId: itemId,
        companyId: part.companyId,
        createdBy: part.createdBy,
        customFields: part.customFields,
      })
      .select("*")
      .single();

    if (partInsert.error) return partInsert;

    const costUpdate = await client
      .from("itemCost")
      .update({ unitCost: part.unitCost })
      .eq("itemId", itemId)
      .select("*")
      .single();

    if (costUpdate.error) return costUpdate;

    return partInsert;
  }

  const itemUpdate = {
    id: part.id,
    name: part.name,
    description: part.description,
    replenishmentSystem: part.replenishmentSystem,
    defaultMethodType: part.defaultMethodType,
    itemTrackingType: part.itemTrackingType,
    unitOfMeasureCode: part.unitOfMeasureCode,
    active: part.active,
  };

  const partUpdate = {
    customFields: part.customFields,
  };

  const [updateItem, updatePart] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("id", part.id),
    client
      .from("part")
      .update({
        ...sanitize(partUpdate),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("itemId", part.id),
  ]);

  if (updateItem.error) return updateItem;
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
    return client.from("pickMethod").insert(pickMethod);
  }

  return client
    .from("pickMethod")
    .update(sanitize(pickMethod))
    .eq("itemId", pickMethod.itemId)
    .eq("locationId", pickMethod.locationId);
}

export async function upsertItemManufacturing(
  client: SupabaseClient<Database>,
  partManufacturing: z.infer<typeof partManufacturingValidator> & {
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

export async function upsertMethodMaterial(
  client: SupabaseClient<Database>,

  methodMaterial:
    | (Omit<z.infer<typeof methodMaterialValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof methodMaterialValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  let materialMakeMethodId: string | null = null;
  if (methodMaterial.methodType === "Make") {
    const makeMethod = await client
      .from("makeMethod")
      .select("id")
      .eq("itemId", methodMaterial.itemId!)
      .single();

    if (makeMethod.error) return makeMethod;
    materialMakeMethodId = makeMethod.data?.id;
  }

  if ("createdBy" in methodMaterial) {
    return client
      .from("methodMaterial")
      .insert([
        {
          ...methodMaterial,
          itemId: methodMaterial.itemId!,
          itemReadableId: methodMaterial.itemReadableId!,
          materialMakeMethodId,
        },
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
      })
    | (z.infer<typeof materialValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in material) {
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
        active: material.active,
        companyId: material.companyId,
        createdBy: material.createdBy,
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const materialInsert = await client
      .from("material")
      .insert({
        id: material.id,
        itemId: itemId,
        materialFormId: material.materialFormId,
        materialSubstanceId: material.materialSubstanceId,
        finish: material.finish,
        grade: material.grade,
        dimensions: material.dimensions,
        companyId: material.companyId,
        createdBy: material.createdBy,
        customFields: material.customFields,
      })
      .select("*")
      .single();

    if (materialInsert.error) return materialInsert;

    const costUpdate = await client
      .from("itemCost")
      .update({ unitCost: material.unitCost })
      .eq("itemId", itemId)
      .select("*")
      .single();

    if (costUpdate.error) return costUpdate;

    return materialInsert;
  }

  const itemUpdate = {
    id: material.id,
    name: material.name,
    description: material.description,
    replenishmentSystem: material.replenishmentSystem,
    defaultMethodType: material.defaultMethodType,
    itemTrackingType: material.itemTrackingType,
    unitOfMeasureCode: material.unitOfMeasureCode,
    active: material.active,
  };

  const materialUpdate = {
    materialFormId: material.materialFormId,
    materialSubstanceId: material.materialSubstanceId,
    finish: material.finish,
    grade: material.grade,
    dimensions: material.dimensions,
    customFields: material.customFields,
  };

  const [updateItem, updateMaterial] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("id", material.id),
    client
      .from("material")
      .update({
        ...sanitize(materialUpdate),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("itemId", material.id),
  ]);

  if (updateItem.error) return updateItem;
  return updateMaterial;
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
        defaultMethodType: service.serviceType === "External" ? "Buy" : "Make",
        itemTrackingType: service.itemTrackingType,
        unitOfMeasureCode: "EA",
        active: service.active,
        companyId: service.companyId,
        createdBy: service.createdBy,
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const serviceInsert = await client
      .from("service")
      .insert({
        id: service.id,
        itemId: itemId,
        serviceType: service.serviceType,
        companyId: service.companyId,
        createdBy: service.createdBy,
        customFields: service.customFields,
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

    return serviceInsert;
  }
  const itemUpdate = {
    id: service.id,
    name: service.name,
    description: service.description,
    replenishmentSystem:
      service.serviceType === "External" ? "Buy" : ("Make" as "Buy"),
    defaultMethodType:
      service.serviceType === "External" ? "Buy" : ("Make" as "Buy"),
    itemTrackingType: service.itemTrackingType,
    unitOfMeasureCode: null,
    active: service.active,
  };

  const serviceUpdate = {
    serviceType: service.serviceType,
  };

  const [updateItem, updateService] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("id", service.id),
    client
      .from("service")
      .update({
        ...sanitize(serviceUpdate),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("itemId", service.id),
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
        name: tool.name,
        type: "Tool",
        replenishmentSystem: tool.replenishmentSystem,
        defaultMethodType: tool.defaultMethodType,
        itemTrackingType: tool.itemTrackingType,
        unitOfMeasureCode: tool.unitOfMeasureCode,
        active: tool.active,
        modelUploadId: tool.modelUploadId,
        companyId: tool.companyId,
        createdBy: tool.createdBy,
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const toolInsert = await client
      .from("tool")
      .insert({
        id: tool.id,
        itemId: itemId,
        companyId: tool.companyId,
        createdBy: tool.createdBy,
        customFields: tool.customFields,
      })
      .select("*")
      .single();

    if (toolInsert.error) return toolInsert;

    const costUpdate = await client
      .from("itemCost")
      .update({ unitCost: tool.unitCost })
      .eq("itemId", itemId)
      .select("*")
      .single();

    if (costUpdate.error) return costUpdate;

    return toolInsert;
  }

  const itemUpdate = {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    replenishmentSystem: tool.replenishmentSystem,
    defaultMethodType: tool.defaultMethodType,
    itemTrackingType: tool.itemTrackingType,
    unitOfMeasureCode: tool.unitOfMeasureCode,
    active: tool.active,
  };

  const toolUpdate = {
    customFields: tool.customFields,
  };

  const [updateItem, updateTool] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("id", tool.id),
    client
      .from("tool")
      .update({
        ...sanitize(toolUpdate),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("itemId", tool.id),
  ]);

  if (updateItem.error) return updateItem;
  return updateTool;
}
