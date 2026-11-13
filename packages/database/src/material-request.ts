// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Material request building blocks shared by the ERP operations and the MES
// route. The MES reaches the ERP only through postings, so they live here.
//
// `@carbon/utils` depends on this package, so `requireAffected` and
// `datetime.timestamp()` cannot be imported. The caller passes the resolve
// time as `at` (`datetime.timestamp()`). The resolve write keeps the same
// contract inline: an update that changed no row returns the
// `CARBON_NOT_APPLIED` error, so an RLS refusal reads as an error.

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.ts";

/** The code `requireAffected` (`@carbon/utils`) gives a write that changed no row. */
const NOT_APPLIED_CODE = "CARBON_NOT_APPLIED";
const NOT_APPLIED_TEXT =
  "You don't have permission to change this record, or it no longer exists.";

export async function createMaterialRequest(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    userId: string;
    jobOperationId: string;
    itemId?: string | null;
    note?: string | null;
    fallbackLocationId?: string | null;
  }
): Promise<{ data: { id: string } | null; error: string | null }> {
  const operation = await client
    .from("jobOperation")
    .select("id, workCenterId, workCenter(locationId)")
    .eq("id", args.jobOperationId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (operation.error) return { data: null, error: operation.error.message };
  if (!operation.data) return { data: null, error: "Operation not found" };

  const itemId = args.itemId || null;
  if (itemId) {
    const item = await client
      .from("item")
      .select("id")
      .eq("id", itemId)
      .eq("companyId", args.companyId)
      .maybeSingle();
    if (item.error) return { data: null, error: item.error.message };
    if (!item.data) return { data: null, error: "Item not found" };
  }

  const locationId =
    operation.data.workCenter?.locationId ?? args.fallbackLocationId ?? null;
  if (!locationId) return { data: null, error: "No location" };

  const inserted = await client
    .from("materialRequest")
    .insert({
      companyId: args.companyId,
      locationId,
      workCenterId: operation.data.workCenterId,
      jobOperationId: operation.data.id,
      itemId,
      note: args.note || null,
      createdBy: args.userId
    })
    .select("id")
    .single();
  if (inserted.error) return { data: null, error: inserted.error.message };
  return { data: inserted.data, error: null };
}

export async function resolveMaterialRequest(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; userId: string; at: string }
): Promise<{ data: { id: string }[] | null; error: PostgrestError | null }> {
  const result = await client
    .from("materialRequest")
    .update({
      status: "Resolved",
      resolvedBy: args.userId,
      resolvedAt: args.at,
      updatedBy: args.userId,
      updatedAt: args.at
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .eq("status", "Open")
    .select("id");
  if (result.error) return { data: null, error: result.error };
  if (result.data.length === 0) {
    return {
      data: null,
      error: {
        name: "PostgrestError",
        code: NOT_APPLIED_CODE,
        message: NOT_APPLIED_TEXT,
        details: "",
        hint: ""
      } as PostgrestError
    };
  }
  return { data: result.data, error: null };
}
