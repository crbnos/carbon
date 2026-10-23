// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { type MrpDeps, runLocationSchedule, runMrp } from "@carbon/planning";
import { getJobDatabaseClient } from "./db";

export type DemoPlanningResult = {
  mrp: "ok" | string;
  schedule: { locationId: string; result: "ok" | string }[];
};

// runMrp rethrows raw PostgREST errors, which are plain objects.
function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String(err.message);
  }
  return JSON.stringify(err);
}

/**
 * The commercial planning group functions for `runMrp`, loaded lazily. Under
 * plain tsx (the `plan:company` script) `@carbon/ee/pegging.server` cannot
 * load: it reaches `@carbon/auth`, whose graph uses Lingui macros. The run
 * then degrades as for a company without PLANNING_GROUPS, as it did before
 * the deps were injected (the check failed and read as "no").
 */
async function loadMrpDeps(): Promise<MrpDeps | undefined> {
  try {
    return (await import("@carbon/ee/pegging.server")).planningGroupMrpDeps;
  } catch (err) {
    console.warn(`Planning groups are off for this run: ${message(err)}`);
    return undefined;
  }
}

/**
 * Same calls as the MRP cron and `api+/schedule.ts`. Must run after the seed commits
 * (both engines read over PostgREST). Never throws: the scheduled MRP run is the backstop.
 */
export async function planDemoCompany({
  companyId,
  userId
}: {
  companyId: string;
  userId: string;
}): Promise<DemoPlanningResult> {
  let client: ReturnType<typeof getCarbonServiceRole>;
  let db: ReturnType<typeof getJobDatabaseClient>;
  try {
    client = getCarbonServiceRole();
    db = getJobDatabaseClient();
  } catch (err) {
    return { mrp: message(err), schedule: [] };
  }

  let mrp: DemoPlanningResult["mrp"] = "ok";
  try {
    await runMrp(
      client,
      db,
      { type: "company", id: companyId, companyId, userId },
      await loadMrpDeps()
    );
  } catch (err) {
    mrp = message(err);
  }

  const schedule: DemoPlanningResult["schedule"] = [];
  let locationIds: string[] = [];
  try {
    const rows = await db
      .selectFrom("job")
      .select("locationId")
      .distinct()
      .where("companyId", "=", companyId)
      .where("status", "in", ["Ready", "In Progress", "Paused"])
      .where("locationId", "is not", null)
      .execute();
    locationIds = rows.flatMap((r) => (r.locationId ? [r.locationId] : []));
  } catch (err) {
    schedule.push({ locationId: "*", result: message(err) });
  }

  for (const locationId of locationIds) {
    try {
      await runLocationSchedule({ db, client, locationId, companyId, userId });
      schedule.push({ locationId, result: "ok" });
    } catch (err) {
      schedule.push({ locationId, result: message(err) });
    }
  }

  return { mrp, schedule };
}
