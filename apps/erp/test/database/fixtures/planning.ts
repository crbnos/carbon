// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The planning database tests' rows: weekly periods, planned orders, planning
// actions and Planned jobs, each in an always-post fixture's company.

import type { KyselyDatabase } from "@carbon/database/client";
import { parseDate } from "@internationalized/date";
import type { Insertable } from "kysely";
import { type Fixture, seed, USER } from "./always-post";

export type PlanningWeek = { id: string; startDate: string; endDate: string };

/**
 * `count` consecutive weeks from `firstDay`, with ids `{prefix}-week-1`, ….
 * `period` has no company, so `cleanup` removes them; their planned orders
 * and planning actions go with them (ON DELETE CASCADE). Each test file
 * takes its own year: a test that looks up the week of a date reads every
 * company's periods.
 */
export async function seedPlanningWeeks(
  f: Fixture,
  count: number,
  firstDay: string
): Promise<{ weeks: PlanningWeek[]; cleanup: () => Promise<void> }> {
  const start = parseDate(firstDay);
  const weeks = Array.from({ length: count }, (_, index) => ({
    id: `${f.prefix}-week-${index + 1}`,
    startDate: start.add({ weeks: index }).toString(),
    endDate: start.add({ weeks: index, days: 6 }).toString()
  }));
  await seed(f, (trx) =>
    trx
      .insertInto("period")
      .values(weeks.map((week) => ({ ...week, periodType: "Week" as const })))
      .execute()
  );
  return {
    weeks,
    cleanup: async () => {
      await f.db
        .deleteFrom("period")
        .where(
          "id",
          "in",
          weeks.map((week) => week.id)
        )
        .execute();
    }
  };
}

type PlannedOrderRow = Insertable<KyselyDatabase["plannedOrder"]>;

/**
 * A planned order of the fixture's part in `week`, id `{prefix}-planned-{key}`:
 * Make, Planned, 10, released on the week's first day and due 4 days later.
 * A Firm one is stamped as firmed by the test user.
 */
export async function seedPlannedOrder(
  f: Fixture,
  overrides: { key: string; week: PlanningWeek } & Partial<
    Omit<PlannedOrderRow, "id" | "companyId">
  >
): Promise<string> {
  const { key, week, ...row } = overrides;
  const id = `${f.prefix}-planned-${key}`;
  const status = row.status ?? "Planned";
  const firstDay = parseDate(week.startDate);
  await seed(f, (trx) =>
    trx
      .insertInto("plannedOrder")
      .values({
        itemId: f.partId,
        locationId: f.locationId,
        planningSegmentId: "",
        orderType: "Make",
        quantity: 10,
        dueDate: firstDay.add({ days: 4 }).toString(),
        releaseDate: firstDay.toString(),
        periodId: week.id,
        splitIndex: 0,
        firmedBy: status === "Firm" ? USER : null,
        firmedAt: status === "Firm" ? f.today : null,
        createdBy: USER,
        ...row,
        status,
        id,
        companyId: f.companyId
      })
      .execute()
  );
  return id;
}

type PlanningActionRow = Insertable<KyselyDatabase["planningAction"]>;

/**
 * An Open planning action on the fixture's part, id `{prefix}-action-{key}`,
 * suggesting 10 today. A change action names its target (`plannedOrderId`,
 * `jobId` or `purchaseOrderLineId`); an Order or Make names none.
 */
export async function seedPlanningAction(
  f: Fixture,
  overrides: {
    key: string;
    type: PlanningActionRow["type"];
    periodId: string;
  } & Partial<Omit<PlanningActionRow, "id" | "companyId">>
): Promise<string> {
  const { key, ...row } = overrides;
  const id = `${f.prefix}-action-${key}`;
  await seed(f, (trx) =>
    trx
      .insertInto("planningAction")
      .values({
        status: "Open",
        itemId: f.partId,
        locationId: f.locationId,
        planningSegmentId: "",
        suggestedQuantity: 10,
        suggestedDate: f.today,
        horizonDate: f.today,
        createdBy: USER,
        ...row,
        id,
        companyId: f.companyId
      })
      .execute()
  );
  return id;
}

/** A Planned job of the fixture's part, id `{prefix}-job-{key}`. */
export async function seedJob(
  f: Fixture,
  args: { key: string; quantity: number }
): Promise<string> {
  const id = `${f.prefix}-job-${args.key}`;
  await seed(f, (trx) =>
    trx
      .insertInto("job")
      .values({
        id,
        jobId: `J-${args.key}`,
        itemId: f.partId,
        quantity: args.quantity,
        status: "Planned",
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute()
  );
  return id;
}

/** Sets an item's scrap rate (a fraction: 0.15 = 15 %). */
export async function seedScrapRate(
  f: Fixture,
  itemId: string,
  scrapPercentage: number
): Promise<void> {
  await seed(f, async (trx) => {
    const rows = await trx
      .updateTable("itemReplenishment")
      .set({ scrapPercentage })
      .where("itemId", "=", itemId)
      .where("companyId", "=", f.companyId)
      .returning("itemId")
      .execute();
    if (rows.length !== 1) {
      throw new Error(`Item ${itemId} has no replenishment row to update`);
    }
  });
}
