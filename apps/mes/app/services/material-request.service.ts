// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { searchFilter } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

const ITEM_COLUMNS = "id, readableIdWithRevision, name, thumbnailPath, type";

type ItemRow = Pick<
  Database["public"]["Tables"]["item"]["Row"],
  "id" | "readableIdWithRevision" | "name" | "thumbnailPath" | "type"
>;

/** Something an operator can ask for: `onOperation` items lead the list. */
export type MaterialRequestOption = ItemRow & { onOperation: boolean };

/** The most catalog items one search returns: the operator narrows by typing. */
const CATALOG_LIMIT = 25;

/**
 * What an operator can ask for at an operation: the operation's own materials
 * and tools first, then the company's consumables and tools. `search` matches
 * the part number or the description.
 */
export async function getMaterialRequestOptions(
  client: SupabaseClient<Database>,
  args: { companyId: string; jobOperationId: string; search: string }
): Promise<{ data: MaterialRequestOption[] | null; error: string | null }> {
  const search = args.search.trim();

  let catalog = client
    .from("item")
    .select(ITEM_COLUMNS)
    .eq("companyId", args.companyId)
    .eq("active", true)
    .in("type", ["Consumable", "Tool"])
    .order("name")
    .order("id")
    .limit(CATALOG_LIMIT);
  if (search)
    catalog = catalog.or(searchFilter(["readableId", "name"], search));

  const [operation, catalogItems] = await Promise.all([
    client
      .from("jobOperation")
      .select(
        `jobMakeMethod(jobMaterial!jobMaterial_jobMakeMethodId_fkey(item(${ITEM_COLUMNS}))), jobOperationTool(item:toolId(${ITEM_COLUMNS}))`
      )
      .eq("id", args.jobOperationId)
      .eq("companyId", args.companyId)
      .maybeSingle(),
    catalog
  ]);
  if (operation.error) return { data: null, error: operation.error.message };
  if (catalogItems.error) {
    return { data: null, error: catalogItems.error.message };
  }

  // The embed's type is too deep for PostgREST's parser to infer.
  const own = operation.data as {
    jobMakeMethod: { jobMaterial: { item: ItemRow | null }[] } | null;
    jobOperationTool: { item: ItemRow | null }[];
  } | null;
  const term = search.toLowerCase();
  const matches = (item: ItemRow) =>
    term === "" ||
    item.name.toLowerCase().includes(term) ||
    (item.readableIdWithRevision ?? "").toLowerCase().includes(term);

  // Keyed by item: a part can sit on several material lines, and a tool on
  // the operation is also in the catalog.
  const options = new Map<string, MaterialRequestOption>();
  for (const { item } of [
    ...(own?.jobMakeMethod?.jobMaterial ?? []),
    ...(own?.jobOperationTool ?? [])
  ]) {
    if (item && matches(item))
      options.set(item.id, { ...item, onOperation: true });
  }
  for (const item of catalogItems.data) {
    if (!options.has(item.id))
      options.set(item.id, { ...item, onOperation: false });
  }
  return { data: [...options.values()], error: null };
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
