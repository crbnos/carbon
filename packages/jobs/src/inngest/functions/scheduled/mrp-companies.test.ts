// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { parseAbsolute } from "@internationalized/date";
import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult
} from "kysely";
import { describe, expect, it } from "vitest";
import {
  companiesWithPlanningWork,
  isMrpDue,
  MRP_TICK_MINUTES,
  mrpTick,
  selectCompaniesForMrp
} from "./mrp-companies";

const companies = [
  { id: "c1", name: "Acme" },
  { id: "c2", name: "Globex" },
  { id: "c3", name: "Initech" }
];

describe("selectCompaniesForMrp", () => {
  it("plans for a company with no companyPlan row", () => {
    // The regression: an empty companyPlan table meant MRP ran for nobody.
    expect(selectCompaniesForMrp(companies, [])).toEqual(companies);
  });

  it("plans for every company when there are no plans to consider", () => {
    // null = not Cloud, or the plan lookup failed.
    expect(selectCompaniesForMrp(companies, null)).toEqual(companies);
  });

  it("skips a cancelled company", () => {
    const result = selectCompaniesForMrp(companies, [
      { id: "c2", stripeSubscriptionStatus: "Canceled" }
    ]);
    expect(result.map((c) => c.id)).toEqual(["c1", "c3"]);
  });

  it("still plans for active, inactive and unknown-status companies", () => {
    const result = selectCompaniesForMrp(companies, [
      { id: "c1", stripeSubscriptionStatus: "Active" },
      { id: "c2", stripeSubscriptionStatus: "Inactive" },
      { id: "c3", stripeSubscriptionStatus: null }
    ]);
    expect(result).toEqual(companies);
  });

  it("ignores a plan row for a company that no longer exists", () => {
    const result = selectCompaniesForMrp(companies, [
      { id: "gone", stripeSubscriptionStatus: "Canceled" }
    ]);
    expect(result).toEqual(companies);
  });

  it("returns nothing when every company is cancelled", () => {
    const result = selectCompaniesForMrp(
      companies,
      companies.map((c) => ({ id: c.id, stripeSubscriptionStatus: "Canceled" }))
    );
    expect(result).toEqual([]);
  });
});

describe("selectCompaniesForMrp with a planning-work lookup", () => {
  it("leaves out a company a run could change nothing for", () => {
    const result = selectCompaniesForMrp(
      companies,
      null,
      new Set(["c1", "c3"])
    );
    expect(result.map((c) => c.id)).toEqual(["c1", "c3"]);
  });

  it("plans for every company when the lookup failed", () => {
    expect(selectCompaniesForMrp(companies, null, null)).toEqual(companies);
  });

  it("still skips a cancelled company that has planning work", () => {
    const result = selectCompaniesForMrp(
      companies,
      [{ id: "c1", stripeSubscriptionStatus: "Canceled" }],
      new Set(["c1", "c2"])
    );
    expect(result.map((c) => c.id)).toEqual(["c2"]);
  });
});

// The Postgres wire is the boundary: the lookup's one statement is recorded
// as compiled SQL, and answered with the rows Postgres would return.
class RecordingDriver extends DummyDriver {
  readonly sent: CompiledQuery[] = [];
  constructor(private readonly rows: { companyId: string | null }[]) {
    super();
  }
  override async acquireConnection(): Promise<DatabaseConnection> {
    return {
      executeQuery: async <R>(
        query: CompiledQuery
      ): Promise<QueryResult<R>> => {
        this.sent.push(query);
        return { rows: this.rows as R[] };
      },
      // biome-ignore lint/correctness/useYield: never streamed
      streamQuery: async function* () {
        throw new Error("not streamed");
      }
    };
  }
}

async function lookup(rows: { companyId: string | null }[] = []) {
  const driver = new RecordingDriver(rows);
  const db = new Kysely<KyselyDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
  const companies = await companiesWithPlanningWork(db);
  expect(driver.sent).toHaveLength(1);
  return { companies, query: driver.sent[0]! };
}

describe("companiesWithPlanningWork", () => {
  it("returns each company once and drops a null", async () => {
    const { companies } = await lookup([
      { companyId: "c1" },
      { companyId: null },
      { companyId: "c2" }
    ]);
    expect([...companies]).toEqual(["c1", "c2"]);
  });

  // A reorder policy orders from on-hand alone: no document, no forecast,
  // nothing an earlier run wrote. Such a company was skipped, and its
  // safety-stock and reorder-point Orders never appeared.
  it("includes a company whose only need is a reorder floor", async () => {
    const { query } = await lookup();
    expect(query.sql).toContain('from "itemPlanning"');
    expect(query.sql).toMatch(/"minimumReserveQuantity" > \$\d+/);
    expect(query.sql).toMatch(/"demandAccumulationSafetyStock" > \$\d+/);
    expect(query.sql).toMatch(/"reorderPoint" > \$\d+/);
    expect(query.parameters).toEqual(
      expect.arrayContaining([
        "Demand-Based Reorder",
        "Fixed Reorder Quantity",
        "Maximum Quantity"
      ])
    );
    // "not Manual Reorder" alone would be every company: it is the default
    expect(query.parameters).not.toContain("Manual Reorder");
  });

  it("includes a company with stock below zero", async () => {
    const { query } = await lookup();
    expect(query.sql).toContain('from "itemStockQuantities"');
    expect(query.sql).toMatch(/"quantityOnHand" < \$\d+/);
  });
});

const utc = (instant: string) => parseAbsolute(instant, "UTC");

/** The ticks of one UTC day a company is due on, as "HH:MM". */
function dueTicks(
  day: string,
  schedule: { timezone: string; mrpRunTime: string | null }
) {
  const due: string[] = [];
  let tick = utc(`${day}T00:00:00Z`);
  for (let i = 0; i < (24 * 60) / MRP_TICK_MINUTES; i++) {
    if (isMrpDue(tick, schedule)) {
      due.push(
        `${String(tick.hour).padStart(2, "0")}:${String(tick.minute).padStart(2, "0")}`
      );
    }
    tick = tick.add({ minutes: MRP_TICK_MINUTES });
  }
  return due;
}

describe("mrpTick", () => {
  it("is the cron slot the run was fired for", () => {
    expect(mrpTick(utc("2026-10-03T08:30:00Z")).toAbsoluteString()).toBe(
      "2026-10-03T08:30:00.000Z"
    );
  });

  it("stays on its slot when the run starts late", () => {
    expect(mrpTick(utc("2026-10-03T08:43:59Z")).toAbsoluteString()).toBe(
      "2026-10-03T08:30:00.000Z"
    );
  });

  it("stays on its slot when the run fires a moment early", () => {
    expect(mrpTick(utc("2026-10-03T08:29:59.800Z")).toAbsoluteString()).toBe(
      "2026-10-03T08:30:00.000Z"
    );
  });
});

describe("isMrpDue with no run time set", () => {
  it("runs every 3 hours, on the hour, in UTC", () => {
    expect(
      dueTicks("2026-10-03", { timezone: "Asia/Kolkata", mrpRunTime: null })
    ).toEqual([
      "00:00",
      "03:00",
      "06:00",
      "09:00",
      "12:00",
      "15:00",
      "18:00",
      "21:00"
    ]);
  });
});

describe("isMrpDue with a run time set", () => {
  it("runs once a day at that time on the company's clock", () => {
    // 2 pm in India is 08:30 UTC — and the 3-hourly runs are gone.
    expect(
      dueTicks("2026-10-03", {
        timezone: "Asia/Kolkata",
        mrpRunTime: "14:00:00"
      })
    ).toEqual(["08:30"]);
  });

  it("follows the company's clock across daylight saving", () => {
    const chicago = { timezone: "America/Chicago", mrpRunTime: "03:00:00" };
    expect(dueTicks("2026-01-15", chicago)).toEqual(["09:00"]);
    expect(dueTicks("2026-07-15", chicago)).toEqual(["08:00"]);
  });

  it("runs on the first tick after a time that is not on a tick", () => {
    expect(
      dueTicks("2026-10-03", { timezone: "UTC", mrpRunTime: "14:07:00" })
    ).toEqual(["14:15"]);
  });

  it("runs just after midnight for a time late in the last tick of the day", () => {
    // 23:50 on Oct 2 is first reached by the 00:00 tick of Oct 3.
    const schedule = { timezone: "UTC", mrpRunTime: "23:50:00" };
    expect(dueTicks("2026-10-03", schedule)).toEqual(["00:00"]);
  });

  it("runs in a zone whose offset is not a whole hour", () => {
    // Kathmandu is UTC+5:45, so 01:00 there is 19:15 UTC the day before.
    expect(
      dueTicks("2026-10-03", {
        timezone: "Asia/Kathmandu",
        mrpRunTime: "01:00:00"
      })
    ).toEqual(["19:15"]);
  });

  it("still runs once on the day the clocks skip the run time", () => {
    // New York, 2026-03-08: 02:00 jumps to 03:00, so 02:30 never happens.
    // The run moves to 03:30 local (07:30 UTC) instead of being skipped.
    expect(
      dueTicks("2026-03-08", {
        timezone: "America/New_York",
        mrpRunTime: "02:30:00"
      })
    ).toEqual(["07:30"]);
  });

  it("runs once on the day the clocks repeat the run time", () => {
    // New York, 2026-11-01: 01:30 happens twice (05:30 and 06:30 UTC).
    expect(
      dueTicks("2026-11-01", {
        timezone: "America/New_York",
        mrpRunTime: "01:30:00"
      })
    ).toEqual(["05:30"]);
  });

  it("accepts a time without seconds", () => {
    expect(
      dueTicks("2026-10-03", { timezone: "UTC", mrpRunTime: "14:00" })
    ).toEqual(["14:00"]);
  });
});
