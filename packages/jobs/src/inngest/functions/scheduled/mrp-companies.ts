// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { filterEmpty } from "@carbon/utils";
import {
  parseTime,
  toCalendarDate,
  toCalendarDateTime,
  toTimeZone,
  toZoned,
  type ZonedDateTime
} from "@internationalized/date";
import type { JobDatabase } from "../../../db";

/** How often the scheduled function fires. Keep in step with its cron. */
export const MRP_TICK_MINUTES = 15;

/** The cadence of a company that has set no run time: every N hours, UTC. */
const MRP_DEFAULT_INTERVAL_HOURS = 3;

/**
 * The cron slot a run belongs to: its start time floored to the tick, in UTC.
 * A run that starts late (a retry, a queue) still answers for its own slot.
 * The one-minute lead absorbs a cron that fires a moment before the boundary,
 * which would otherwise floor into the previous slot and skip this one.
 */
export function mrpTick(instant: ZonedDateTime): ZonedDateTime {
  const utc = toTimeZone(instant, "UTC").add({ minutes: 1 });
  return utc.set({
    minute: utc.minute - (utc.minute % MRP_TICK_MINUTES),
    second: 0,
    millisecond: 0
  });
}

/**
 * Whether a scheduled tick should plan for a company.
 *
 * `mrpRunTime` (companySettings, a wall-clock "HH:MM:SS") is the company's
 * chosen time of day on its own clock (`company.timezone`). With none set the
 * company keeps the default cadence, every 3 hours. With one set it runs once
 * a day instead, on the first tick at or after that time.
 *
 * "First tick at or after" is tested against the run time's INSTANT rather
 * than by comparing local hours, so a day whose clocks skip the run time
 * (spring forward) still runs — at the moment the skipped time resolves to —
 * and a day that repeats it (fall back) runs once, not twice. Yesterday's run
 * time is checked too: one set late in the day's last tick is first reached
 * just after midnight.
 */
export function isMrpDue(
  tick: ZonedDateTime,
  schedule: { timezone: string; mrpRunTime: string | null }
): boolean {
  if (!schedule.mrpRunTime) {
    return tick.minute === 0 && tick.hour % MRP_DEFAULT_INTERVAL_HOURS === 0;
  }

  const runTime = parseTime(schedule.mrpRunTime);
  const today = toCalendarDate(toTimeZone(tick, schedule.timezone));

  return [today, today.subtract({ days: 1 })].some((date) => {
    const sinceRunTime = tick.compare(
      toZoned(toCalendarDateTime(date, runTime), schedule.timezone)
    );
    return sinceRunTime >= 0 && sinceRunTime < MRP_TICK_MINUTES * 60 * 1000;
  });
}

/**
 * Which companies a scheduled MRP run should plan for. A company with no
 * `companyPlan` row still runs — MRP is not a paid feature.
 *
 * `plans` is null when there are none to consider (not Cloud, or the lookup
 * failed), which means plan for everyone: planning for a cancelled company
 * wastes a little work, planning for nobody is the bug this function exists for.
 */
export function selectCompaniesForMrp<T extends { id: string }>(
  companies: T[],
  plans: { id: string; stripeSubscriptionStatus: string | null }[] | null,
  withPlanningWork: ReadonlySet<string> | null = null
): T[] {
  // null = the lookup failed, which means plan for everyone, for the same
  // reason as `plans`.
  if (withPlanningWork) {
    companies = companies.filter((company) => withPlanningWork.has(company.id));
  }
  if (!plans) return companies;

  // Only "Canceled" — the status the weekly job deletes on. "Inactive" (e.g.
  // payment past due) still plans.
  const cancelled = new Set(
    plans
      .filter((plan) => plan.stripeSubscriptionStatus === "Canceled")
      .map((plan) => plan.id)
  );

  return companies.filter((company) => !cancelled.has(company.id));
}

/**
 * The companies a run can change anything for: open demand or supply to plan,
 * or rows an earlier run wrote that a new one would clear. For every other
 * company `runMrp` reads its inputs, finds nothing and rewrites nothing, which
 * was 93% of scheduled runs and the largest share of server time (2026-10-01
 * traces). Each source is a superset of what `runMrp` reads (projections and
 * actuals are not narrowed to the planning horizon), so a company is only left
 * out when a run would be a no-op.
 */
export async function companiesWithPlanningWork(
  db: JobDatabase
): Promise<Set<string>> {
  const rows = await db
    .selectFrom("openSalesOrderLines")
    .select("companyId")
    .union(db.selectFrom("openJobMaterialLines").select("companyId"))
    .union(db.selectFrom("openProductionOrders").select("companyId"))
    .union(db.selectFrom("openPurchaseOrderLines").select("companyId"))
    .union(db.selectFrom("demandProjection").select("companyId"))
    .union(db.selectFrom("demandForecastSource").select("companyId"))
    .union(db.selectFrom("supplyForecast").select("companyId"))
    // A run clears the worklist of a company whose demand is gone; without
    // this a company with no other planning work keeps its stale actions.
    .union(db.selectFrom("planningAction").select("companyId"))
    .union(
      db
        .selectFrom("demandForecast")
        .select("companyId")
        .where("forecastMethod", "=", "mrp")
    )
    .union(
      db
        .selectFrom("demandActual")
        .select("companyId")
        .where("actualQuantity", "!=", 0)
    )
    .union(
      db
        .selectFrom("supplyActual")
        .select("companyId")
        .where("actualQuantity", "!=", 0)
    )
    .execute();

  return new Set(filterEmpty(rows.map((row) => row.companyId)));
}
