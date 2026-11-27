// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Reads the project form runs in the browser (through the caller's client).

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RdActivityRole } from "./projects.models";

type Client = SupabaseClient<Database>;

/**
 * The Construction in Progress classes a capital project can build its
 * assets in. Read directly: `getFixedAssetClassesList` drops CIP classes while
 * `CONSTRUCTION_IN_PROGRESS_ENABLED` is false.
 */
export async function getCipFixedAssetClasses(
  client: Client,
  companyId: string
) {
  return client
    .from("fixedAssetClass")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("isConstructionInProgress", true)
    .order("name");
}

/**
 * Lists the active planning groups of the company, for a picker.
 */
export async function getPlanningGroupsList(client: Client, companyId: string) {
  return client
    .from("planningGroup")
    .select("id, name, locationId")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

/**
 * The advisory lock key of one timesheet cell, from the columns every read of
 * the cell in `save` matches exactly. The job and job operation are left out:
 * a save that leaves them out reads the cell whatever the job, so it waits on
 * a save of any job. The input schema takes the date as `YYYY-MM-DD` only, so
 * one cell always has one key.
 */
export function timesheetCellLockKey(cell: {
  companyId: string;
  employeeId: string;
  entryDate: string;
  projectId: string;
  projectElementId: string | null;
  laborCategoryId: string;
  workLocationId: string | null;
  rdActivityRole: RdActivityRole | null;
}): string {
  // JSON keeps each column apart and null distinct from any id.
  return `timesheet-cell:${JSON.stringify([
    cell.companyId,
    cell.employeeId,
    cell.entryDate,
    cell.projectId,
    cell.projectElementId,
    cell.laborCategoryId,
    cell.workLocationId,
    cell.rdActivityRole
  ])}`;
}
