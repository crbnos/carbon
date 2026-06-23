import { SUPABASE_URL } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type {
  DocumentTemplate,
  DocumentTemplateType
} from "@carbon/documents/template";
import { toDocumentTemplate } from "@carbon/documents/template";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zfd } from "zod-form-data";

/**
 * Load a stored document template as a `DocumentTemplate | null` to pass to a
 * PDF/ZPL generator (which runs it through `resolveTemplate`). Returns null when
 * nothing is stored, so the output falls back to the type's default.
 */
export async function getDocumentTemplateConfig(
  client: SupabaseClient<Database>,
  companyId: string,
  documentType: DocumentTemplateType
): Promise<DocumentTemplate | null> {
  const stored = await client
    .from("documentTemplate")
    .select("*")
    .eq("companyId", companyId)
    .eq("documentType", documentType)
    .maybeSingle();
  return toDocumentTemplate(stored.data, documentType);
}

export const inventoryAdjustmentValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  storageUnitId: zfd.text(z.string().optional()),
  entryType: z.enum(["Positive Adjmt.", "Negative Adjmt."]),
  quantity: zfd.numeric(z.number().min(1, { message: "Quantity is required" }))
});

export async function getBatchNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    isReadOnly?: boolean;
  }
) {
  let itemIds = [args.itemId];
  const item = await client
    .from("item")
    .select("*")
    .eq("id", args.itemId)
    .single();
  if (item.data?.type === "Material") {
    const items = await client
      .from("item")
      .select("id")
      .eq("readableId", item.data.readableId)
      .eq("companyId", args.companyId);
    if (items.data?.length) {
      itemIds = items.data.map((item) => item.id);
    }
  }

  // Smart default order: expiring soonest first (FEFO, nulls last), then oldest
  // first (FIFO).
  return client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .in("sourceDocumentId", itemIds)
    .eq("companyId", args.companyId)
    .gt("quantity", 0)
    .order("expirationDate", { ascending: true, nullsFirst: false })
    .order("createdAt", { ascending: true });
}

export async function getCompanySettings(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companySettings")
    .select("*")
    .eq("id", companyId)
    .single();
}

const PUBLIC_STORAGE_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/public/`;

export async function getCompany(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const company = await client
    .from("company")
    .select("*")
    .eq("id", companyId)
    .single();
  if (company.error || !company.data) return company;
  // Logos are stored as storage paths; expand to full public URLs (matches the
  // ERP getCompany) so they're fetchable by the PDF/ZPL pipeline.
  const url = (p: string | null) =>
    p ? `${PUBLIC_STORAGE_URL_PREFIX}${p}` : p;
  return {
    data: {
      ...company.data,
      logoLight: url(company.data.logoLight),
      logoDark: url(company.data.logoDark),
      logoLightIcon: url(company.data.logoLightIcon),
      logoDarkIcon: url(company.data.logoDarkIcon)
    },
    error: null
  };
}

export async function getSerialNumbersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
  }
) {
  let itemIds = [args.itemId];
  const item = await client
    .from("item")
    .select("*")
    .eq("id", args.itemId)
    .single();
  if (item.data?.type === "Material") {
    const items = await client
      .from("item")
      .select("id")
      .eq("readableId", item.data.readableId)
      .eq("companyId", args.companyId);
    if (items.data?.length) {
      itemIds = items.data.map((item) => item.id);
    }
  }

  // Smart default order: expiring soonest first (FEFO, nulls last), then oldest
  // first (FIFO).
  return client
    .from("trackedEntity")
    .select("*")
    .eq("sourceDocument", "Item")
    .in("sourceDocumentId", itemIds)
    .eq("companyId", args.companyId)
    .eq("status", "Available")
    .gt("quantity", 0)
    .order("expirationDate", { ascending: true, nullsFirst: false })
    .order("createdAt", { ascending: true });
}

/**
 * Available tracked entities for an item at a location, one row per entity, with
 * its bin, on-hand, and FEFO/FIFO order keys — for the shared TrackedEntityPicker.
 * `excludeLineside` drops lineside (work-center) bins; `excludeAllocated` nets out
 * quantities already allocated to other non-cancelled picking lines.
 */
export async function getAvailableTrackedEntities(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    locationId: string;
    excludeLineside?: boolean;
    excludeAllocated?: boolean;
    excludeLineId?: string | null;
  }
) {
  return client.rpc("get_available_tracked_entities", {
    p_item_id: args.itemId,
    p_company_id: args.companyId,
    p_location_id: args.locationId,
    p_exclude_lineside: args.excludeLineside ?? false,
    p_exclude_allocated: args.excludeAllocated ?? false,
    p_exclude_line_id: args.excludeLineId ?? undefined
  });
}

/**
 * The configured tracked-entity pick order for an item at a location, used as
 * the picker's default sort. Falls back to "Default" (smart) when unset.
 */
export async function getPickOrder(
  client: SupabaseClient<Database>,
  args: { itemId: string; locationId: string; companyId: string }
): Promise<Database["public"]["Enums"]["pickMethodSortMethod"]> {
  const { data } = await client
    .from("pickMethod")
    .select("sortMethod")
    .eq("itemId", args.itemId)
    .eq("locationId", args.locationId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  return data?.sortMethod ?? "Default";
}

export type PickingListRecommendation = {
  trackedEntityId: string;
  readableId: string | null;
};

/**
 * The recommended tracked entities (serial/batch lots) for each tracked picking
 * line, in pick order — surfaced as at-a-glance subtext before the picker opens.
 * One batched RPC fetches every available lot for every item on the list; we then
 * greedily assign distinct lots to lines in pick order so the same serial is never
 * recommended to two lines, and a batch lot is split across lines by remaining qty.
 * Returns a map of pickingListLineId → recommended lots (empty/partial if short).
 */
export async function getPickingListRecommendations(
  client: SupabaseClient<Database>,
  pickingListId: string
): Promise<Record<string, PickingListRecommendation[]>> {
  const [linesResult, availableResult] = await Promise.all([
    client
      .from("pickingListLine")
      .select(
        "id, itemId, quantityToPick, quantityPicked, status, item(itemTrackingType)"
      )
      .eq("pickingListId", pickingListId)
      .order("jobOperationId")
      .order("itemId"),
    client.rpc("get_picking_list_tracked_available", {
      p_picking_list_id: pickingListId
    })
  ]);

  const recommendations: Record<string, PickingListRecommendation[]> = {};
  if (linesResult.error || availableResult.error) return recommendations;

  // Ordered, mutable pool of available lots per item (the RPC already orders each
  // item's rows by its configured pick method).
  const poolByItem = new Map<
    string,
    Array<{ trackedEntityId: string; readableId: string | null; qty: number }>
  >();
  for (const row of availableResult.data ?? []) {
    const list = poolByItem.get(row.itemId) ?? [];
    list.push({
      trackedEntityId: row.trackedEntityId,
      readableId: row.readableId,
      qty: Number(row.availableQuantity ?? 0)
    });
    poolByItem.set(row.itemId, list);
  }

  for (const line of linesResult.data ?? []) {
    const trackingType = (line.item as { itemTrackingType?: string } | null)
      ?.itemTrackingType;
    if (trackingType !== "Serial" && trackingType !== "Batch") continue;

    let remaining =
      Number(line.quantityToPick ?? 0) - Number(line.quantityPicked ?? 0);
    if (remaining <= 0) continue;

    const pool = poolByItem.get(line.itemId);
    if (!pool?.length) continue;

    const picks: PickingListRecommendation[] = [];
    while (remaining > 0 && pool.length > 0) {
      const lot = pool[0];
      picks.push({
        trackedEntityId: lot.trackedEntityId,
        readableId: lot.readableId
      });
      const take = Math.min(lot.qty, remaining);
      remaining -= take;
      lot.qty -= take;
      if (lot.qty <= 0) pool.shift();
    }
    recommendations[line.id] = picks;
  }

  return recommendations;
}

export type JobMaterialPickedQuantity = {
  quantityPicked: number;
  quantityToPick: number;
};

/**
 * How much of each job material has been picked, summed across every live picking-list
 * line that references it. A job material can legitimately span several picking lists,
 * so we sum per `jobMaterialId`. We only count lines whose parent list is actually being
 * worked ("In Progress"/"Completed"): cancelling or drafting a list does NOT cascade a
 * status down to its lines, so a Cancelled/Draft list would otherwise inflate the
 * to-pick total with stale lines. Picking is optional — materials with no picking
 * activity simply have no entry in the returned map. Never throws (returns {}).
 */
export async function getPickedQuantitiesByJobMaterial(
  client: SupabaseClient<Database>,
  jobMaterialIds: string[]
): Promise<Record<string, JobMaterialPickedQuantity>> {
  const picked: Record<string, JobMaterialPickedQuantity> = {};
  if (jobMaterialIds.length === 0) return picked;

  const { data, error } = await client
    .from("pickingListLine")
    .select(
      "jobMaterialId, quantityToPick, quantityPicked, pickingList!inner(status)"
    )
    .in("jobMaterialId", jobMaterialIds)
    .neq("status", "Cancelled")
    .in("pickingList.status", ["In Progress", "Completed"]);

  if (error || !data) return picked;

  for (const line of data) {
    if (!line.jobMaterialId) continue;
    const entry = (picked[line.jobMaterialId] ??= {
      quantityPicked: 0,
      quantityToPick: 0
    });
    entry.quantityPicked += Number(line.quantityPicked ?? 0);
    entry.quantityToPick += Number(line.quantityToPick ?? 0);
  }

  return picked;
}

export async function insertManualInventoryAdjustment(
  client: SupabaseClient<Database>,
  inventoryAdjustment: z.infer<typeof inventoryAdjustmentValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  // Check if it's a negative adjustment and if the quantity is sufficient
  if (inventoryAdjustment.entryType === "Negative Adjmt.") {
    inventoryAdjustment.quantity = -Math.abs(inventoryAdjustment.quantity);
  }

  return client
    .from("itemLedger")
    .insert([inventoryAdjustment])
    .select("*")
    .single();
}
