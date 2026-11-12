// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Traveler print rules shared by the ERP (a picking list starts) and the MES
// (an operation completes), plus the read the print job uses to find the
// units a picking list's travelers print for.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.ts";

/**
 * Travelers print once, when a picking list leaves Draft for In Progress.
 * A list that returns to In Progress from Completed or Partial already
 * printed them.
 */
export function shouldPrintTravelers(
  previous: string | null | undefined,
  next: string | null | undefined
): boolean {
  return previous === "Draft" && next === "In Progress";
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
