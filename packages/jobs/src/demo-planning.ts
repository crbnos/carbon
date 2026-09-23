import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { runLocationSchedule, runMrp } from "@carbon/planning";
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
 * Run MRP and the scheduler once over a freshly seeded company — the same calls
 * the MRP cron and `api+/schedule.ts` make. Must run after the seed commits (both
 * engines read over PostgREST and open their own transactions). Never throws:
 * planning is best-effort, and the 3-hourly MRP cron is the backstop.
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
    await runMrp(client, db, {
      type: "company",
      id: companyId,
      companyId,
      userId
    });
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
