import type { Database, Json } from "@carbon/database";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  consumableValidator,
  fixtureValidator,
  itemCostValidator,
  itemGroupValidator,
  itemInventoryValidator,
  itemPlanningValidator,
  itemPurchasingValidator,
  itemSupplierValidator,
  itemUnitSalePriceValidator,
  itemValidator,
  materialFormValidator,
  materialSubstanceValidator,
  materialValidator,
  partManufacturingValidator,
  partValidator,
  serviceValidator,
  toolValidator,
  unitOfMeasureValidator,
} from "./items.models";

export async function deleteItemGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("itemGroup").delete().eq("id", id);
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

export async function deleteUnitOfMeasure(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("unitOfMeasure").delete().eq("id", id);
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
      `id.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%`
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
    .eq("blocked", false)
    .eq("active", true);

  return query.order("name");
}

export async function getFixture(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("fixtures")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .single();
}

export async function getFixtures(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("fixtures")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `id.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%`
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

export async function getFixturesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  let query = client
    .from("item")
    .select("id, name, readableId")
    .eq("type", "Fixture")
    .eq("companyId", companyId)
    .eq("blocked", false)
    .eq("active", true);

  return query.order("name");
}

export async function getItemCost(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemCost")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .single();
}

export async function getItemGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("itemGroup").select("*").eq("id", id).single();
}

export async function getItemGroups(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("itemGroup")
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

export async function getItemGroupsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("itemGroup")
    .select("id, name", { count: "exact" })
    .eq("companyId", companyId)
    .order("name");
}

export async function getItemInventory(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client
    .from("itemInventory")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .maybeSingle();
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
      `id.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%`
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
    .eq("blocked", false)
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
      `id.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%`
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
    .eq("blocked", false)
    .eq("active", true);

  return query.order("name");
}

export async function getItemQuantities(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client
    .from("itemQuantities")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .maybeSingle();
}

export async function getItemSuppliers(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("itemSupplier")
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
    .from("services")
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
    query = query.eq("serviceType", args.type);
  }

  if (args.group) {
    query = query.eq("itemGroupId", args.group);
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
    .from("services")
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
    .eq("blocked", false)
    .eq("active", true)
    .order("name");

  return query;
}

export async function getShelvesList(
  client: SupabaseClient<Database>,
  locationId: string
) {
  return client
    .from("shelf")
    .select("id")
    .eq("active", true)
    .eq("locationId", locationId)
    .order("id");
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

  if (args.search) {
    query = query.or(
      `id.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%`
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
    .eq("blocked", false)
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

export async function insertShelf(
  client: SupabaseClient<Database>,
  shelfId: string,
  locationId: string,
  userId: string,
  companyId: string
) {
  const shelfLookup = await client
    .from("shelf")
    .select("id")
    .eq("id", shelfId)
    .eq("locationId", locationId)
    .maybeSingle();
  if (shelfLookup.error) return shelfLookup;

  // the shelf is inactive, so we can just reactivate it
  if (shelfLookup.data) {
    return client.from("shelf").update({ active: true }).eq("id", shelfId);
  }

  // otherwise we'll create a new shelf
  return client
    .from("shelf")
    .insert([
      {
        id: shelfId,
        companyId,
        locationId,
        createdBy: userId,
      },
    ])
    .select("id")
    .single();
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
        itemGroupId: consumable.itemGroupId,
        itemInventoryType: consumable.itemInventoryType,
        unitOfMeasureCode: consumable.unitOfMeasureCode,
        companyId: consumable.companyId,
        createdBy: consumable.createdBy,
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    return client
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
  }

  const itemUpdate = {
    id: consumable.id,
    name: consumable.name,
    description: consumable.description,
    itemGroupId: consumable.itemGroupId,
    itemInventoryType: consumable.itemInventoryType,
    unitOfMeasureCode: consumable.unitOfMeasureCode,
    active: consumable.active,
    blocked: consumable.blocked,
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

export async function upsertFixture(
  client: SupabaseClient<Database>,
  fixture:
    | (z.infer<typeof fixtureValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof fixtureValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in fixture) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: fixture.id,
        name: fixture.name,
        type: "Fixture",
        itemGroupId: fixture.itemGroupId,
        itemInventoryType: fixture.itemInventoryType,
        unitOfMeasureCode: "EA",
        companyId: fixture.companyId,
        createdBy: fixture.createdBy,
      })
      .select("id")
      .single();

    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    return client
      .from("fixture")
      .insert({
        id: fixture.id,
        itemId: itemId,
        companyId: fixture.companyId,
        customerId: fixture.customerId ? fixture.customerId : undefined,
        createdBy: fixture.createdBy,
        customFields: fixture.customFields,
      })
      .select("*")
      .single();
  }

  const itemUpdate = {
    id: fixture.id,
    name: fixture.name,
    description: fixture.description,
    itemGroupId: fixture.itemGroupId,
    itemInventoryType: fixture.itemInventoryType,
    unitOfMeasureCode: "EA",
    active: fixture.active,
    blocked: fixture.blocked,
  };

  const fixtureUpdate = {
    customerId: fixture.customerId,
    customFields: fixture.customFields,
  };

  const [updateItem, updateFixture] = await Promise.all([
    client
      .from("item")
      .update({
        ...sanitize(itemUpdate),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("id", fixture.id),
    client
      .from("fixture")
      .update({
        ...sanitize(fixtureUpdate),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("itemId", fixture.id),
  ]);

  if (updateItem.error) return updateItem;
  return updateFixture;
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
        itemGroupId: part.itemGroupId,
        itemInventoryType: part.itemInventoryType,
        unitOfMeasureCode: part.unitOfMeasureCode,
        companyId: part.companyId,
        createdBy: part.createdBy,
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    return client
      .from("part")
      .insert({
        id: part.id,
        itemId: itemId,
        replenishmentSystem: part.replenishmentSystem,
        companyId: part.companyId,
        createdBy: part.createdBy,
        customFields: part.customFields,
      })
      .select("*")
      .single();
  }

  const itemUpdate = {
    id: part.id,
    name: part.name,
    description: part.description,
    itemGroupId: part.itemGroupId,
    itemInventoryType: part.itemInventoryType,
    unitOfMeasureCode: part.unitOfMeasureCode,
    active: part.active,
    blocked: part.blocked,
  };

  const partUpdate = {
    replenishmentSystem: part.replenishmentSystem,
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

export async function upsertItemInventory(
  client: SupabaseClient<Database>,
  itemInventory:
    | (z.infer<typeof itemInventoryValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof itemInventoryValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in itemInventory) {
    return client.from("itemInventory").insert(itemInventory);
  }

  return client
    .from("itemInventory")
    .update(sanitize(itemInventory))
    .eq("itemId", itemInventory.itemId)
    .eq("locationId", itemInventory.locationId);
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

export async function upsertItemGroup(
  client: SupabaseClient<Database>,
  itemGroup:
    | (Omit<z.infer<typeof itemGroupValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof itemGroupValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in itemGroup) {
    return client.from("itemGroup").insert([itemGroup]).select("*").single();
  }
  return (
    client
      .from("itemGroup")
      .update(sanitize(itemGroup))
      // @ts-ignore
      .eq("id", itemGroup.id)
      .select("id")
      .single()
  );
}

export async function upsertItemSupplier(
  client: SupabaseClient<Database>,
  itemSupplier:
    | (Omit<z.infer<typeof itemSupplierValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof itemSupplierValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in itemSupplier) {
    return client
      .from("itemSupplier")
      .insert([itemSupplier])
      .select("id")
      .single();
  }
  return client
    .from("itemSupplier")
    .update(sanitize(itemSupplier))
    .eq("id", itemSupplier.id)
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
        itemGroupId: material.itemGroupId,
        itemInventoryType: material.itemInventoryType,
        unitOfMeasureCode: material.unitOfMeasureCode,
        companyId: material.companyId,
        createdBy: material.createdBy,
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    return client
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
  }

  const itemUpdate = {
    id: material.id,
    name: material.name,
    description: material.description,
    itemGroupId: material.itemGroupId,
    itemInventoryType: material.itemInventoryType,
    unitOfMeasureCode: material.unitOfMeasureCode,
    active: material.active,
    blocked: material.blocked,
  };

  const materialUpdate = {
    materialFormId: material.materialFormId,
    materialSubstanceId: material.materialSubstanceId,
    finish: material.finish,
    grade: material.grade,
    dimensions: material.dimensions,
    customFields: material.customFields,
  };

  const [updateItem, updatePart] = await Promise.all([
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
  return updatePart;
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
        itemGroupId: service.itemGroupId,
        itemInventoryType: service.itemInventoryType,
        unitOfMeasureCode: null,
        companyId: service.companyId,
        createdBy: service.createdBy,
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    return client
      .from("service")
      .insert({
        id: service.id,
        itemId: itemId,
        serviceType: service.serviceType,
        companyId: service.companyId,
        createdBy: service.createdBy,
      })
      .select("*")
      .single();
  }
  const itemUpdate = {
    id: service.id,
    name: service.name,
    description: service.description,
    itemGroupId: service.itemGroupId,
    itemInventoryType: service.itemInventoryType,
    unitOfMeasureCode: null,
    active: service.active,
    blocked: service.blocked,
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
        itemGroupId: tool.itemGroupId,
        itemInventoryType: tool.itemInventoryType,
        unitOfMeasureCode: tool.unitOfMeasureCode,
        companyId: tool.companyId,
        createdBy: tool.createdBy,
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    return client
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
  }

  const itemUpdate = {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    itemGroupId: tool.itemGroupId,
    itemInventoryType: tool.itemInventoryType,
    unitOfMeasureCode: tool.unitOfMeasureCode,
    active: tool.active,
    blocked: tool.blocked,
  };

  const toolUpdate = {
    customFields: tool.customFields,
  };

  const [updateItem, updatePart] = await Promise.all([
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
  return updatePart;
}
