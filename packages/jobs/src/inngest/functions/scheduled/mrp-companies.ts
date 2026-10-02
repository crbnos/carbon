// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { filterEmpty } from "@carbon/utils";
import type { JobDatabase } from "../../../db";

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
