// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Traveler print rules shared by the ERP and the MES: the claim of a picking
// list's one traveler print, the operation label rule, and the read the print
// job uses to find the units a picking list's travelers print for.

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.ts";

/** A list in one of these statuses has not started, so its travelers wait. */
export const TRAVELER_UNSTARTED_STATUSES = ["Draft", "Cancelled"] as const;

/**
 * Claims the one print of a picking list's travelers. One conditional UPDATE
 * sets `travelersPrintedAt` to `at` when the list has left Draft, is not
 * Cancelled and has no `travelersPrintedAt` yet. Only the call that sets it
 * gets `claimed: true`, so two picks at the same moment print once, and a
 * pick that takes a list from Draft straight to Completed or Partial prints.
 *
 * Call it after the status write or the pick, with a client that can update
 * the row whatever the caller's permissions (the service role). `at` is
 * `datetime.timestamp()` (`@carbon/utils`), which this package cannot import.
 * The manual Print travelers action does not claim, so a reprint always works.
 */
export async function claimTravelerPrint(
  client: SupabaseClient<Database>,
  args: { pickingListId: string; companyId: string; at: string }
): Promise<{
  claimed: boolean;
  locationId: string | null;
  error: PostgrestError | null;
}> {
  const result = await client
    .from("pickingList")
    .update({ travelersPrintedAt: args.at })
    .eq("id", args.pickingListId)
    .eq("companyId", args.companyId)
    .is("travelersPrintedAt", null)
    .not("status", "in", `(${TRAVELER_UNSTARTED_STATUSES.join(",")})`)
    .select("locationId")
    .maybeSingle();
  if (result.error) {
    return { claimed: false, locationId: null, error: result.error };
  }
  return {
    claimed: result.data !== null,
    locationId: result.data?.locationId ?? null,
    error: null
  };
}

export type OperationLabelInput = {
  isFirstOperation: boolean;
  isLastOperation: boolean;
  isTopLevelMakeMethod: boolean;
  travelerLabels: boolean;
  printLabelOnCompletion: boolean;
};

/**
 * The last operation of the top-level make method prints the finished-unit
 * label when the flag is on. The first operation prints the unit label only
 * when travelers do not already carry it.
 */
export function shouldPrintOperationLabel(input: OperationLabelInput): boolean {
  if (
    input.isLastOperation &&
    input.isTopLevelMakeMethod &&
    input.printLabelOnCompletion
  ) {
    return true;
  }
  return input.isFirstOperation && !input.travelerLabels;
}

/**
 * The live units of the top-level make methods of every job on a picking
 * list, in serial order (as `getTrackedEntitiesByMakeMethodId`).
 */
export async function getPickingListTravelerEntities(
  client: SupabaseClient<Database>,
  args: { pickingListId: string; companyId: string }
) {
  const { pickingListId, companyId } = args;

  const pickingList = await client
    .from("pickingList")
    .select("id, pickingListId")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!pickingList.data) {
    return { data: null, readableId: null, error: pickingList.error };
  }

  const lines = await client
    .from("pickingListLine")
    .select("jobId")
    .eq("pickingListId", pickingListId)
    .eq("companyId", companyId);
  if (lines.error) {
    return { data: null, readableId: null, error: lines.error };
  }
  const jobIds = [...new Set((lines.data ?? []).map((line) => line.jobId))];
  if (jobIds.length === 0) {
    return {
      data: [],
      readableId: pickingList.data.pickingListId,
      error: null
    };
  }

  const makeMethods = await client
    .from("jobMakeMethod")
    .select("id")
    .in("jobId", jobIds)
    .is("parentMaterialId", null)
    .eq("companyId", companyId);
  if (makeMethods.error) {
    return { data: null, readableId: null, error: makeMethods.error };
  }
  const makeMethodIds = (makeMethods.data ?? []).map((m) => m.id);
  if (makeMethodIds.length === 0) {
    return {
      data: [],
      readableId: pickingList.data.pickingListId,
      error: null
    };
  }

  const trackedEntities = await client
    .from("trackedEntity")
    .select("*")
    .in("attributes->>Job Make Method", makeMethodIds)
    .eq("companyId", companyId)
    .not("status", "in", "(Consumed,Rejected,Scrapped)")
    .order("createdAt", { ascending: true })
    .order("readableId", { ascending: true })
    .order("id", { ascending: true });
  if (trackedEntities.error) {
    return { data: null, readableId: null, error: trackedEntities.error };
  }

  return {
    data: trackedEntities.data,
    readableId: pickingList.data.pickingListId,
    error: null
  };
}
