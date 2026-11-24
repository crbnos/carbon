// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A serial unit is on hold while an issue that is not Closed is linked to it
// (`nonConformanceTrackedEntity`) and the company has turned the rule on
// (`companySettings.holdUnitsWithOpenIssues`). Nothing is stored: closing the
// issue releases the unit, reopening it holds the unit again.
//
// "On hold", never "held": a held unit is the one on the operator's screen
// (`resolveWorkUnit`'s `heldUnitId`).

import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { chunkArray } from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { UnitHolds } from "~/utils/unitHold";

const log = getLogger("mes", "unit-hold");

type Client = SupabaseClient<Database>;

/** PostgREST's URL carries the ids: a longer list is read in parts. */
const UNIT_IDS_PER_READ = 100;

/**
 * The open issues that hold each of `unitIds`, oldest first. A unit with none
 * has no key. Empty when the company has not turned the rule on: one read of
 * its settings and nothing else.
 */
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

  const reads = await Promise.all(
    chunkArray(unitIds, UNIT_IDS_PER_READ).map((ids) =>
      client
        .from("nonConformanceTrackedEntity")
        .select(
          "trackedEntityId, nonConformance!inner(id, nonConformanceId, name, description, status, createdAt, nonConformanceType(name))"
        )
        .in("trackedEntityId", ids)
        .eq("companyId", args.companyId)
        .neq("nonConformance.status", "Closed")
    )
  );

  const holds: UnitHolds = {};
  for (const read of reads) {
    if (read.error) return { data: null, error: read.error };
    for (const row of read.data ?? []) {
      const issue = row.nonConformance;
      // Restated here: the status filter above is on an embedded table.
      if (!issue || issue.status === "Closed") continue;
      const issues = holds[row.trackedEntityId] ?? [];
      issues.push({
        id: issue.id,
        readableId: issue.nonConformanceId,
        name: issue.name,
        description: issue.description,
        type: issue.nonConformanceType?.name ?? null,
        status: issue.status,
        createdAt: issue.createdAt
      });
      holds[row.trackedEntityId] = issues;
    }
  }
  for (const issues of Object.values(holds)) {
    issues.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        a.readableId.localeCompare(b.readableId)
    );
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
