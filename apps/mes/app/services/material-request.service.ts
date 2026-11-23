// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { searchFilter } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

const ITEM_COLUMNS = "id, readableIdWithRevision, name, thumbnailPath, type";

/** Something an operator can ask for. */
export type RequestableItem = Pick<
  Database["public"]["Tables"]["item"]["Row"],
  "id" | "readableIdWithRevision" | "name" | "thumbnailPath" | "type"
>;

/**
 * What the job itself calls for at an operation: its make method's materials,
 * the components of the kits among them, and the operation's tools.
 */
export async function getJobRequestItems(
  client: SupabaseClient<Database>,
  args: { companyId: string; jobOperationId: string }
): Promise<{ data: RequestableItem[] | null; error: string | null }> {
  const operation = await client
    .from("jobOperation")
    .select(
      `jobMakeMethod(jobMaterial!jobMaterial_jobMakeMethodId_fkey(kit, item(${ITEM_COLUMNS}), kitMethods:jobMakeMethod!jobMakeMethod_parentMaterialId_fkey(id))), jobOperationTool(item:toolId(${ITEM_COLUMNS}))`
    )
    .eq("id", args.jobOperationId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (operation.error) return { data: null, error: operation.error.message };

  // The embed's type is too deep for PostgREST's parser to infer.
  const own = operation.data as {
    jobMakeMethod: {
      jobMaterial: {
        kit: boolean;
        item: RequestableItem | null;
        kitMethods: { id: string }[];
      }[];
    } | null;
    jobOperationTool: { item: RequestableItem | null }[];
  } | null;
  const materials = own?.jobMakeMethod?.jobMaterial ?? [];

  const kitMethodIds = materials.flatMap((material) =>
    material.kit ? material.kitMethods.map((method) => method.id) : []
  );
  const components = kitMethodIds.length
    ? await client
        .from("jobMaterial")
        .select(`item(${ITEM_COLUMNS})`)
        .in("jobMakeMethodId", kitMethodIds)
        .eq("companyId", args.companyId)
        .neq("methodType", "Make to Order")
    : { data: [], error: null };
  if (components.error) return { data: null, error: components.error.message };

  // Keyed by item: a part can sit on several material lines.
  const items = new Map<string, RequestableItem>();
  for (const { item } of [
    ...materials,
    ...(components.data as { item: RequestableItem | null }[]),
    ...(own?.jobOperationTool ?? [])
  ]) {
    if (item) items.set(item.id, item);
  }
  return { data: [...items.values()], error: null };
}

/** The most catalog items one search returns: the operator narrows by typing. */
const CATALOG_LIMIT = 25;

/**
 * The company's consumables and tools, for what a job does not list. `search`
 * matches the part number, as shown, or the description.
 */
export function searchRequestCatalog(
  client: SupabaseClient<Database>,
  args: { companyId: string; search: string }
) {
  const catalog = client
    .from("item")
    .select(ITEM_COLUMNS)
    .eq("companyId", args.companyId)
    .eq("active", true)
    .in("type", ["Consumable", "Tool"])
    .order("name")
    .order("id")
    .limit(CATALOG_LIMIT);
  const search = args.search.trim();
  return search
    ? catalog.or(searchFilter(["readableIdWithRevision", "name"], search))
    : catalog;
}

/** The most requests the board shows: the oldest are the ones to work. */
const BOARD_LIMIT = 200;

/** The open requests at a location, oldest first: the water spider's list. */
export function getOpenMaterialRequests(
  client: SupabaseClient<Database>,
  args: { companyId: string; locationId: string }
) {
  return client
    .from("materialRequest")
    .select(
      `id, note, createdAt, item(${ITEM_COLUMNS}), workCenter(name), jobOperation(description, job(jobId)), requester:user!materialRequest_createdBy_fkey(fullName)`
    )
    .eq("status", "Open")
    .eq("companyId", args.companyId)
    .eq("locationId", args.locationId)
    .order("createdAt")
    .order("id")
    .limit(BOARD_LIMIT);
}

export type OpenMaterialRequest = NonNullable<
  Awaited<ReturnType<typeof getOpenMaterialRequests>>["data"]
>[number];

export function getOpenMaterialRequestCount(
  client: SupabaseClient<Database>,
  args: { companyId: string; locationId: string }
) {
  return client
    .from("materialRequest")
    .select("id", { count: "exact", head: true })
    .eq("status", "Open")
    .eq("companyId", args.companyId)
    .eq("locationId", args.locationId);
}
