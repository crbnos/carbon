// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The units on hold for a quality issue, read for the MES screens and for
// the unit rule (`resolveWorkUnit`).

import { type Database, fetchAllByIds } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { UnitHolds } from "./unit-hold";

const log = getLogger("lib", "unit-hold");

type Client = SupabaseClient<Database>;

/** Open issues and closed rejecting dispositions, by serial in display order. */
export async function readUnitHolds(
  client: Client,
  args: { companyId: string; unitIds: string[] }
): Promise<
  { data: UnitHolds; error: null } | { data: null; error: PostgrestError }
> {
  const settings = await client
    .from("companySettings")
    .select("holdUnitsWithOpenIssues")
    .eq("id", args.companyId)
    .maybeSingle();
  if (settings.error) return { data: null, error: settings.error };

  const unitIds = [...new Set(args.unitIds)];
  if (!settings.data?.holdUnitsWithOpenIssues || unitIds.length === 0) {
    return { data: {}, error: null };
  }

  const read = await fetchAllByIds<
    Database["public"]["Views"]["unitQualityHold"]["Row"]
  >(unitIds, (ids) =>
    client
      .from("unitQualityHold")
      .select("*")
      .in("trackedEntityId", ids)
      .eq("companyId", args.companyId)
      .order("trackedEntityId")
      .order("createdAt")
      .order("issueNumber")
      .order("issueId")
  );
  if (read.error) return { data: null, error: read.error };
  const holds: UnitHolds = {};
  for (const row of read.data) {
    // These columns come from non-null base columns; the generated view type
    // marks all columns nullable.
    (holds[row.trackedEntityId!] ??= []).push({
      id: row.issueId!,
      readableId: row.issueNumber!,
      name: row.name!,
      type: row.issueType,
      description: row.description,
      status: row.status!,
      createdAt: row.createdAt!,
      ...(row.disposition ? { disposition: row.disposition } : {})
    });
  }
  return { data: holds, error: null };
}

/**
 * The holds an operation screen shows for its units. A lot is never on hold.
 * A failed read shows none, like the ability gate: the screen then offers the
 * work, and `resolveWorkUnit` (which refuses when it cannot read) decides.
 */
export async function readScreenUnitHolds(
  client: Client,
  args: {
    companyId: string;
    operationId: string;
    serial: boolean;
    unitIds: string[];
  }
): Promise<UnitHolds> {
  if (!args.serial) return {};
  const holds = await readUnitHolds(client, args);
  if (holds.error) {
    log.error("Could not read the units on hold for the operation screen", {
      companyId: args.companyId,
      operationId: args.operationId,
      error: holds.error
    });
    return {};
  }
  return holds.data;
}
