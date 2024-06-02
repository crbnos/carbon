import type { Database, Json } from "@carbon/database";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  partCostValidator,
  partGroupValidator,
  partInventoryValidator,
  partManufacturingValidator,
  partPlanningValidator,
  partPurchasingValidator,
  partSupplierValidator,
  partUnitSalePriceValidator,
  partValidator,
  serviceSupplierValidator,
  serviceValidator,
  unitOfMeasureValidator,
} from "./parts.models";
import type { PartReplenishmentSystem, ServiceType } from "./types";

export async function deletePartGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("partGroup").delete().eq("id", id);
}

export async function deleteUnitOfMeasure(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("unitOfMeasure").delete().eq("id", id);
}

export async function getPartCost(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("partCost")
    .select("*")
    .eq("partId", id)
    .eq("companyId", companyId)
    .single();
}

export async function getPartGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("partGroup").select("*").eq("id", id).single();
}

export async function getPartGroups(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("partGroup")
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

export async function getPartGroupsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("partGroup")
    .select("id, name", { count: "exact" })
    .eq("companyId", companyId)
    .order("name");
}

export async function getPartInventory(
  client: SupabaseClient<Database>,
  partId: string,
  companyId: string,
  locationId: string
) {
  return client
    .from("partInventory")
    .select("*")
    .eq("partId", partId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .maybeSingle();
}

export async function getPartManufacturing(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("partReplenishment")
    .select("*")
    .eq("partId", id)
    .eq("companyId", companyId)
    .single();
}

export async function getPartPlanning(
  client: SupabaseClient<Database>,
  partId: string,
  companyId: string,
  locationId: string
) {
  return client
    .from("partPlanning")
    .select("*")
    .eq("partId", partId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .maybeSingle();
}

export async function getPartReplenishment(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("partReplenishment")
    .select("*")
    .eq("partId", id)
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
  companyId: string,
  replenishmentSystem: PartReplenishmentSystem | null
) {
  let query = client
    .from("part")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("blocked", false)
    .eq("active", true);

  if (replenishmentSystem) {
    query = query.or(
      `replenishmentSystem.eq.${replenishmentSystem},replenishmentSystem.eq.Buy and Make`
    );
  }

  return query.order("name");
}

export async function getPartQuantities(
  client: SupabaseClient<Database>,
  partId: string,
  companyId: string,
  locationId: string
) {
  return client
    .from("partQuantities")
    .select("*")
    .eq("partId", partId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .maybeSingle();
}

export async function getPart(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("part")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getPartSuppliers(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("partSupplier")
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
    .eq("partId", id)
    .eq("companyId", companyId);
}

export async function getPartUnitSalePrice(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("partUnitSalePrice")
    .select("*")
    .eq("partId", id)
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
    query = query.eq("partGroupId", args.group);
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
  id: string,
  companyId: string
) {
  return client
    .from("services")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getServicesList(
  client: SupabaseClient<Database>,
  companyId: string,
  type: ServiceType | null
) {
  let query = client
    .from("service")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("blocked", false)
    .eq("active", true)
    .order("name");

  if (type) {
    query = query.eq("serviceType", type);
  }

  return query;
}

export async function getServiceSuppliers(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("serviceSupplier")
    .select(`id, supplier(id, name), customFields, supplierServiceId`)
    .eq("serviceId", id)
    .eq("companyId", companyId)
    .eq("active", true);
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
        type: "part",
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
        ...part,
        itemId,
      })
      .select("*")
      .single();
  }
  return client
    .from("part")
    .update({
      ...sanitize(part),
      updatedAt: today(getLocalTimeZone()).toString(),
    })
    .eq("id", part.id);
}

export async function upsertPartCost(
  client: SupabaseClient<Database>,
  partCost: z.infer<typeof partCostValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("partCost")
    .update(sanitize(partCost))
    .eq("partId", partCost.partId);
}

export async function upsertPartInventory(
  client: SupabaseClient<Database>,
  partInventory:
    | (z.infer<typeof partInventoryValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof partInventoryValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in partInventory) {
    return client.from("partInventory").insert(partInventory);
  }

  return client
    .from("partInventory")
    .update(sanitize(partInventory))
    .eq("partId", partInventory.partId)
    .eq("locationId", partInventory.locationId);
}

export async function upsertPartManufacturing(
  client: SupabaseClient<Database>,
  partManufacturing: z.infer<typeof partManufacturingValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("partReplenishment")
    .update(sanitize(partManufacturing))
    .eq("partId", partManufacturing.partId);
}

export async function upsertPartPlanning(
  client: SupabaseClient<Database>,
  partPlanning:
    | {
        companyId: string;
        partId: string;
        locationId: string;
        createdBy: string;
      }
    | (z.infer<typeof partPlanningValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in partPlanning) {
    return client.from("partPlanning").insert(partPlanning);
  }
  return client
    .from("partPlanning")
    .update(sanitize(partPlanning))
    .eq("partId", partPlanning.partId)
    .eq("locationId", partPlanning.locationId);
}

export async function upsertPartPurchasing(
  client: SupabaseClient<Database>,
  partPurchasing: z.infer<typeof partPurchasingValidator> & {
    updatedBy: string;
  }
) {
  return client
    .from("partReplenishment")
    .update(sanitize(partPurchasing))
    .eq("partId", partPurchasing.partId);
}

export async function upsertPartGroup(
  client: SupabaseClient<Database>,
  partGroup:
    | (Omit<z.infer<typeof partGroupValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof partGroupValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in partGroup) {
    return client.from("partGroup").insert([partGroup]).select("*").single();
  }
  return (
    client
      .from("partGroup")
      .update(sanitize(partGroup))
      // @ts-ignore
      .eq("id", partGroup.id)
      .select("id")
      .single()
  );
}

export async function upsertPartSupplier(
  client: SupabaseClient<Database>,
  partSupplier:
    | (Omit<z.infer<typeof partSupplierValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof partSupplierValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in partSupplier) {
    return client
      .from("partSupplier")
      .insert([partSupplier])
      .select("id")
      .single();
  }
  return client
    .from("partSupplier")
    .update(sanitize(partSupplier))
    .eq("id", partSupplier.id)
    .select("id")
    .single();
}

export async function upsertPartUnitSalePrice(
  client: SupabaseClient<Database>,
  partUnitSalePrice: z.infer<typeof partUnitSalePriceValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("partUnitSalePrice")
    .update(sanitize(partUnitSalePrice))
    .eq("partId", partUnitSalePrice.partId);
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
    return client.from("service").insert(service).select("*").single();
  }
  return client
    .from("service")
    .update({
      ...sanitize(service),
      updatedAt: today(getLocalTimeZone()).toString(),
    })
    .eq("id", service.id);
}

export async function upsertServiceSupplier(
  client: SupabaseClient<Database>,
  serviceSupplier:
    | (Omit<z.infer<typeof serviceSupplierValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof serviceSupplierValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in serviceSupplier) {
    return client
      .from("serviceSupplier")
      .insert([serviceSupplier])
      .select("id")
      .single();
  }
  return client
    .from("serviceSupplier")
    .update(sanitize(serviceSupplier))
    .eq("id", serviceSupplier.id)
    .select("id")
    .single();
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
