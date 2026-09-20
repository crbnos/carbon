import type { Database, Tables } from "@carbon/database";
import { getContentType, getFileExtension } from "@carbon/files";
import type {
  PostgrestResponse,
  PostgrestSingleResponse,
  SupabaseClient
} from "@supabase/supabase-js";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import type { PriceBreak, SupplierPriceMap } from "./shared.models";
import type { ItemModelUpload } from "./types";

export async function deleteNote(
  client: SupabaseClient<Database>,
  noteId: string
) {
  return client.from("note").update({ active: false }).eq("id", noteId);
}

export async function deleteSavedView(
  client: SupabaseClient<Database>,
  viewId: string
) {
  return client.from("tableView").delete().eq("id", viewId);
}

export async function generateEmbedding(
  client: SupabaseClient<Database>,
  text: string
): Promise<number[]> {
  const response = await client.functions.invoke("embedding", {
    body: { text }
  });

  if (response.error) {
    throw new Error(
      `Failed to generate embedding: ${
        response.error.message || "Unknown error"
      }`
    );
  }

  if (!response.data?.embedding) {
    throw new Error("No embedding returned from function");
  }

  return response.data.embedding as number[];
}

export async function getBase64ImageFromSupabase(
  client: SupabaseClient<Database>,
  path: string
) {
  // Legacy stored HEIC can't be decoded by consumers (PDF rendering) — serve
  // the imgproxy JPEG rendition instead. Everything else passes through raw.
  const extension = getFileExtension(path);
  const heic = extension === "heic" || extension === "heif";

  const { data, error } = await client.storage
    .from("private")
    .download(path, heic ? { transform: { quality: 90 } } : undefined);
  if (error) {
    return null;
  }

  const base64String = Buffer.from(await data.arrayBuffer()).toString("base64");

  const contentType = heic ? "image/jpeg" : getContentType(extension);
  const mimeType = contentType.startsWith("image/") ? contentType : "image/png";

  return `data:${mimeType};base64,${base64String}`;
}

export async function getCountries(client: SupabaseClient<Database>) {
  return client.from("country").select("*").order("name");
}

/**
 * Timezone names from the database's own tzdata (pg_timezone_names via the
 * get_timezone_names RPC) — the authoritative list for what AT TIME ZONE
 * resolves.
 */
export async function getTimezoneNames(client: SupabaseClient<Database>) {
  return client.rpc("get_timezone_names");
}

export { getDocumentType } from "@carbon/files";

/**
 * The item's CAD model in the same shape the line views expose it, so it drops
 * straight into `<CadModel modelUpload={...} />`. Always the full shape — an item
 * with no model is every field null, never a narrower branch.
 */
export async function getModelByItemId(
  client: SupabaseClient<Database>,
  itemId: string
): Promise<ItemModelUpload> {
  const item = await client
    .from("item")
    .select("id, modelUploadId")
    .eq("id", itemId)
    .single();

  const noModel: ItemModelUpload = {
    itemId: item.data?.id ?? null,
    modelId: null,
    modelName: null,
    modelPath: null,
    modelSize: null,
    thumbnailPath: null
  };

  if (!item.data?.modelUploadId) return noModel;

  const model = await client
    .from("modelUpload")
    .select("id, name, modelPath, size, thumbnailPath")
    .eq("id", item.data.modelUploadId)
    .maybeSingle();

  if (!model.data) return noModel;

  return {
    itemId: item.data.id,
    modelId: model.data.id,
    modelName: model.data.name,
    modelPath: model.data.modelPath,
    modelSize: model.data.size,
    thumbnailPath: model.data.thumbnailPath
  };
}

export async function getNotes(
  client: SupabaseClient<Database>,
  documentId: string
) {
  return client
    .from("note")
    .select(
      "id, note, createdAt, user!notes_createdBy_fkey(id, fullName, avatarUrl)"
    )
    .eq("documentId", documentId)
    .eq("active", true)
    .order("createdAt");
}

export async function getPeriods(
  client: SupabaseClient<Database>,
  { startDate, endDate }: { startDate: string; endDate: string }
) {
  const endWithTime = endDate.includes("T") ? endDate : `${endDate}T23:59:59`;
  return client
    .from("period")
    .select("*")
    .gte("startDate", startDate)
    .lte("endDate", endWithTime);
}

export async function getSavedViews(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("tableView")
    .select("*")
    .eq("createdBy", userId)
    .eq("companyId", companyId)
    .order("name");
}

export async function getTagsList(
  client: SupabaseClient<Database>,
  companyId: string,
  table?: string | null
) {
  let query = client.from("tag").select("name").eq("companyId", companyId);

  if (table) {
    query = query.eq("table", table);
  }

  return query.order("name");
}

export async function importCsv(
  client: SupabaseClient<Database>,
  args: {
    table: string;
    filePath: string;
    columnMappings: Record<string, string>;
    enumMappings?: Record<string, string[]>;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("import-csv", {
    body: args
  });
}

export async function insertNote(
  client: SupabaseClient<Database>,
  note: {
    note: string;
    documentId: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client.from("note").insert([note]).select("*").single();
}

export async function insertTag(
  client: SupabaseClient<Database>,
  tag: Database["public"]["Tables"]["tag"]["Insert"]
) {
  return client.from("tag").insert(tag).select("*").single();
}

export async function getExternalLink(
  client: SupabaseClient<Database>,
  id: string
) {
  let query = client.from("externalLink").select("*").eq("id", id).single();

  return query;
}

export async function upsertExternalLink(
  client: SupabaseClient<Database>,
  externalLink:
    | Database["public"]["Tables"]["externalLink"]["Insert"]
    | Database["public"]["Tables"]["externalLink"]["Update"]
) {
  if ("id" in externalLink && externalLink.id) {
    return client
      .from("externalLink")
      .update(externalLink)
      .eq("id", externalLink.id)
      .select("id")
      .single();
  }
  return client
    .from("externalLink")
    .insert(
      externalLink as Database["public"]["Tables"]["externalLink"]["Insert"]
    )
    .select("id")
    .single();
}

export async function getCustomerPortals(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("externalLink")
    .select("*", { count: "exact" })
    .eq("companyId", companyId)
    .eq("documentType", "Customer");

  if (args?.search) {
    query = query.ilike("customer.name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getCustomerPortal(
  client: SupabaseClient<Database>,
  id: string
): Promise<
  PostgrestSingleResponse<
    Tables<"externalLink"> & {
      customer: Pick<Tables<"customer">, "id" | "name">;
    }
  >
> {
  return client
    .from("externalLink")
    .select("*, customer(id, name)")
    .eq("id", id)
    .eq("documentType", "Customer")
    .single();
}

export async function updateModelThumbnail(
  client: SupabaseClient<Database>,
  modelId: string,
  thumbnailPath: string
) {
  return client.from("modelUpload").update({ thumbnailPath }).eq("id", modelId);
}

export async function upsertModelUpload(
  client: SupabaseClient<Database>,
  upload:
    | {
        id: string;
        modelPath: string;
        companyId: string;
        createdBy: string;
      }
    | {
        id: string;
        name: string;
        size: number;
        thumbnailPath: string;
      }
) {
  if ("createdBy" in upload) {
    return client.from("modelUpload").insert(upload);
  }
  return client.from("modelUpload").update(upload).eq("id", upload.id);
}

export async function updateNote(
  client: SupabaseClient<Database>,
  id: string,
  note: string
) {
  return client.from("note").update({ note }).eq("id", id);
}

export async function upsertSavedView(
  client: SupabaseClient<Database>,
  view: {
    id?: string;
    name: string;
    description?: string;
    table: string;
    type: "Public" | "Private";
    filters?: string[];
    sorts?: string[];
    columnPinning?: Record<string, boolean>;
    columnVisibility?: Record<string, boolean>;
    columnOrder?: string[];
    userId: string;
    companyId: string;
  }
) {
  const { userId, ...data } = view;
  if ("id" in view && view.id) {
    return client
      .from("tableView")
      .update({
        ...data,
        updatedBy: userId
      })
      .eq("id", view.id)
      .select("id")
      .single();
  }

  const { data: maxSortOrderData, error: maxSortOrderError } = await client
    .from("tableView")
    .select("sortOrder")
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxSortOrderError) {
    return { data: null, error: maxSortOrderError };
  }

  const newSortOrder = maxSortOrderData ? maxSortOrderData.sortOrder + 1 : 1;

  return client
    .from("tableView")
    .insert({
      ...data,
      createdBy: userId,
      sortOrder: newSortOrder
    })
    .select("id")
    .single();
}

export async function updateSavedViewOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    sortOrder: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
    client.from("tableView").update({ sortOrder, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

/**
 * Core sync lookup: given price break tiers and a requested quantity,
 * return the unit price from the highest qualifying tier
 * (where tier.quantity <= requestedQty). Falls back to fallbackPrice.
 */
export function lookupPriceFromBreaks(
  priceBreaks: PriceBreak[],
  requestedQty: number,
  fallbackPrice: number
): number {
  const eligible = priceBreaks.filter((pb) => pb.quantity <= requestedQty);
  if (eligible.length) {
    return eligible.reduce((best, pb) =>
      pb.quantity > best.quantity ? pb : best
    ).unitPrice;
  }
  return fallbackPrice;
}

/**
 * Map-aware wrapper: look up itemId in a SupplierPriceMap, then resolve
 * via lookupPriceFromBreaks. Used by useLineCosts for BOM tree costing.
 */
export function lookupBuyPriceFromMap(
  itemId: string,
  requestedQty: number,
  priceMap: SupplierPriceMap,
  fallbackCost: number
): number {
  const entry = priceMap[itemId];
  if (!entry) return fallbackCost;
  return lookupPriceFromBreaks(
    entry.priceBreaks,
    requestedQty,
    entry.fallbackUnitPrice ?? fallbackCost
  );
}

/**
 * What a "Purchase to Order" quote material's unit cost IS: a typed cost wins,
 * anything else re-resolves from supplier price breaks. Every reader of a
 * bought-to-order cost must go through this — reaching for
 * lookupBuyPriceFromMap directly silently ignores a typed cost.
 *
 * Mirrored in the Deno edge runtime (`functions/lib/methods.ts`).
 */
export function resolveBuyUnitCost(
  material: {
    itemId: string;
    unitCost: number;
    unitCostSource?: string | null;
  },
  requestedQty: number,
  priceMap: SupplierPriceMap
): number {
  if (material.unitCostSource === "manual") return material.unitCost;
  return lookupBuyPriceFromMap(
    material.itemId,
    requestedQty,
    priceMap,
    material.unitCost
  );
}

/**
 * Resolve the supplier unit price for a quantity.
 *
 * `supplierPart.unitPrice` and `supplierPartPrice.unitPrice` are stored in the
 * company BASE currency -- neither table has a currency column, and all three
 * writers put base there. The field this feeds (`supplierUnitPrice`) is in the
 * SUPPLIER's currency. The document's `exchangeRate` is foreign-per-base, so
 * base to supplier is MULTIPLY.
 *
 * @param fallbackUnitPrice base currency, used when no break matches
 * @returns the price in the supplier's currency
 */
export function resolveSupplierPrice(
  priceBreaks: PriceBreak[],
  quantity: number,
  fallbackUnitPrice: number,
  exchangeRate: number
): number {
  const basePrice = priceBreaks.length
    ? lookupPriceFromBreaks(priceBreaks, quantity, fallbackUnitPrice)
    : fallbackUnitPrice;
  return basePrice * exchangeRate;
}

// -----------------------------------------------------------------------------
// Enforcement Rules (storage + sales families)
// -----------------------------------------------------------------------------
// Both rule families live in ONE `enforcementRule` table discriminated by
// `family`, so the admin CRUD is written once here rather than duplicated in
// `inventory.service.ts` and `sales.service.ts`. Callers pass their family
// explicitly — there is no per-family wrapper to keep in sync, and adding a
// third family costs nothing here.
//
// Cross-app queries (assignment loaders, evaluator fetches) live in
// `@carbon/ee/rules`; this file is the ERP-only admin surface, because it
// depends on ERP request-utils (GenericQueryFilters, sanitize).

export type EnforcementRuleFamily =
  Database["public"]["Enums"]["enforcementRuleFamily"];

export type EnforcementRuleRow =
  Database["public"]["Tables"]["enforcementRule"]["Row"];

// Authoring writes (`upsertEnforcementRule` / `deleteEnforcementRule`) and their
// `EnforcementRuleInsert` / `EnforcementRuleUpdate` input types moved to
// `@carbon/ee/rules.server` (`packages/ee/src/rules/service.server.ts`), where
// they embed the commercial `requireEntitlement` gate. The read helpers below
// stay here (ERP admin surface, client-safe).

export async function getEnforcementRules(
  client: SupabaseClient<Database>,
  family: EnforcementRuleFamily,
  companyId: string,
  args?: GenericQueryFilters & {
    search: string | null;
    targetType?:
      | Database["public"]["Enums"]["enforcementRuleTargetType"]
      | null;
  }
): Promise<PostgrestResponse<EnforcementRuleRow>> {
  let query = client
    .from("enforcementRule")
    .select("*", { count: "exact" })
    .eq("companyId", companyId)
    .eq("family", family);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }
  if (args?.targetType) {
    query = query.eq("targetType", args.targetType);
  }

  // The `family` argument is a union rather than a literal, which is enough to
  // drop PostgREST's inferred row type to `any`; state it once here so every
  // caller gets a real row instead of re-annotating at each call site.
  return setGenericQueryFilters(query, args ?? {}, [
    { column: "name", ascending: true }
  ]) as unknown as Promise<PostgrestResponse<EnforcementRuleRow>>;
}

export async function getEnforcementRule(
  client: SupabaseClient<Database>,
  family: EnforcementRuleFamily,
  id: string,
  companyId: string
): Promise<PostgrestSingleResponse<EnforcementRuleRow>> {
  return (
    client
      .from("enforcementRule")
      .select("*")
      .eq("id", id)
      .eq("family", family)
      // RLS scopes the user client already; the explicit predicate is
      // defense-in-depth for service-role callers (these functions are
      // MCP-exposed).
      .eq("companyId", companyId)
      // Same union-family `any` collapse as `getEnforcementRules` above.
      .single() as unknown as Promise<
      PostgrestSingleResponse<EnforcementRuleRow>
    >
  );
}

/**
 * Pin counts per rule id. Rule ids are globally unique, so counting by id needs
 * no family predicate even though the item table is shared between families.
 * Work-center pins only exist for the storage family; passing sales ids simply
 * matches nothing there.
 */
export async function getEnforcementRuleAssignmentCounts(
  client: SupabaseClient<Database>,
  ruleIds: string[]
) {
  if (ruleIds.length === 0) return { data: {}, error: null };

  const tables = [
    "enforcementRuleItemAssignment",
    "enforcementRuleWorkCenterAssignment"
  ] as const;

  const results = await Promise.all(
    tables.map((table) =>
      client.from(table).select("ruleId").in("ruleId", ruleIds)
    )
  );

  const counts: Record<string, number> = {};
  for (const { data, error } of results) {
    if (error) return { data: {}, error };
    for (const row of (data ?? []) as Array<{ ruleId: string }>) {
      counts[row.ruleId] = (counts[row.ruleId] ?? 0) + 1;
    }
  }

  return { data: counts, error: null };
}
