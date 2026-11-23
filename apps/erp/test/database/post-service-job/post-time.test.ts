// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyTimeZone, journalReference } from "@carbon/database";
import { datetime } from "@carbon/utils";
import { expect } from "vitest";
import { SERVICE_LABOR_COST_RATE_MISSING } from "../../../app/modules/service/service.service";
import { databaseTest } from "../fixtures/local-database";
import { serviceJobFixture } from "../fixtures/service-job";

type Fixture = Awaited<ReturnType<typeof serviceJobFixture>>;

/** Runs `post-time` and returns the journal it wrote, or null. */
async function postTime(f: Fixture, serviceJobId: string) {
  const posted = await f.postServiceJob({ action: "post-time", serviceJobId });
  expect(posted.error).toBeNull();
  return posted.data?.journalId ?? null;
}

async function jobFor(f: Fixture) {
  const { locationId } = await f.addStockedItem("unit", {
    quantity: 1,
    unitCost: 10
  });
  return f.addJob({ locationId, coverage: "Billable" });
}

databaseTest(
  "a closed entry posts hours × the cost rate, keyed by the entry",
  async () => {
    const f = await serviceJobFixture();
    try {
      const job = await jobFor(f);
      const entry = await f.addTime(job.id, { hours: 1.5 });

      const journalId = await postTime(f, job.id);
      expect(journalId).not.toBeNull();
      expect(await f.journalLines(journalId as string)).toEqual([
        [f.account("cost-of-service"), 60],
        [f.account("labor-absorption"), -60]
      ]);

      const references = await f.db
        .selectFrom("journalLine")
        .select(["documentType", "documentId", "documentLineReference"])
        .distinct()
        .where("journalId", "=", journalId as string)
        .execute();
      expect(references).toEqual([
        {
          documentType: "Service Job",
          documentId: job.id,
          documentLineReference: journalReference.to.serviceJobTime(entry.id)
        }
      ]);
      const journal = await f.db
        .selectFrom("journal")
        .select(["sourceType", "status"])
        .where("id", "=", journalId as string)
        .executeTakeFirstOrThrow();
      expect(journal).toEqual({ sourceType: "Service Job", status: "Posted" });

      // Nothing changed: no second journal.
      expect(await postTime(f, job.id)).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("an edit posts the difference", async () => {
  const f = await serviceJobFixture();
  try {
    const job = await jobFor(f);
    const entry = await f.addTime(job.id, { hours: 1.5 });
    await postTime(f, job.id);

    await f.db
      .updateTable("serviceJobTime")
      .set({ hours: 2 })
      .where("id", "=", entry.id)
      .execute();
    const edited = await postTime(f, job.id);
    expect(await f.journalLines(edited as string)).toEqual([
      [f.account("cost-of-service"), 20],
      [f.account("labor-absorption"), -20]
    ]);
  } finally {
    await f.cleanup();
  }
});

databaseTest("a deleted entry reverses its cost", async () => {
  const f = await serviceJobFixture();
  try {
    const job = await jobFor(f);
    const entry = await f.addTime(job.id, { hours: 2 });
    await postTime(f, job.id);

    await f.db.deleteFrom("serviceJobTime").where("id", "=", entry.id).execute();
    const removed = await postTime(f, job.id);
    expect(await f.journalLines(removed as string)).toEqual([
      [f.account("labor-absorption"), 80],
      [f.account("cost-of-service"), -80]
    ]);

    // The entry nets to 0 across its journals.
    const net = await f.db
      .selectFrom("journalLine")
      .select((eb) => eb.fn.sum<number>("amount").as("amount"))
      .where("documentLineReference", "=", journalReference.to.serviceJobTime(entry.id))
      .where("accountId", "=", f.account("cost-of-service"))
      .executeTakeFirstOrThrow();
    expect(Number(net.amount)).toBe(0);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a posted entry keeps its rate; a new entry takes the new one",
  async () => {
    const f = await serviceJobFixture();
    try {
      const job = await jobFor(f);
      const first = await f.addTime(job.id, { hours: 1 });
      await postTime(f, job.id);

      await f.db
        .updateTable("companySettings")
        .set({ serviceLaborCostRate: 50 })
        .where("id", "=", f.companyId)
        .execute();
      const second = await f.addTime(job.id, { hours: 1 });
      const journalId = await postTime(f, job.id);
      expect(await f.journalLines(journalId as string)).toEqual([
        [f.account("cost-of-service"), 50],
        [f.account("labor-absorption"), -50]
      ]);

      const rates = await f.db
        .selectFrom("serviceJobTime")
        .select(["id", "unitCost"])
        .where("serviceJobId", "=", job.id)
        .execute();
      const rateOf = (id: string) =>
        Number(rates.find((row) => row.id === id)?.unitCost);
      expect(rateOf(first.id)).toBe(40);
      expect(rateOf(second.id)).toBe(50);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a running clock posts nothing", async () => {
  const f = await serviceJobFixture();
  try {
    const job = await jobFor(f);
    const running = await f.addTime(job.id, { hours: 1, running: true });

    expect(await postTime(f, job.id)).toBeNull();
    const row = await f.db
      .selectFrom("serviceJobTime")
      .select(["unitCost"])
      .where("id", "=", running.id)
      .executeTakeFirstOrThrow();
    expect(row.unitCost).toBeNull();
  } finally {
    await f.cleanup();
  }
});

databaseTest("an entry with no cost rate is refused", async () => {
  const f = await serviceJobFixture();
  try {
    const job = await jobFor(f);
    await f.db
      .updateTable("companySettings")
      .set({ serviceLaborCostRate: null })
      .where("id", "=", f.companyId)
      .execute();
    await f.addTime(job.id, { hours: 1 });

    const refused = await f.postServiceJob({
      action: "post-time",
      serviceJobId: job.id
    });
    expect(refused.error?.message).toBe(SERVICE_LABOR_COST_RATE_MISSING);
  } finally {
    await f.cleanup();
  }
});

/**
 * Splits the fixture's one open period: January 2025 Open, February 2025 in
 * `february`, and the fixture's period from March 2025 on (it holds today).
 * Returns the two new periods' ids.
 */
async function splitPeriods(f: Fixture, february: "Open" | "Closed" | "Locked") {
  await f.db
    .updateTable("accountingPeriod")
    .set({ startDate: "2025-03-01" })
    .where("id", "=", `${f.prefix}-period`)
    .where("companyId", "=", f.companyId)
    .execute();
  const rows = await f.db
    .insertInto("accountingPeriod")
    .values(
      (
        [
          ["2025-01-01", "2025-01-31", 1, "Open"],
          ["2025-02-01", "2025-02-28", 2, february]
        ] as const
      ).map(([startDate, endDate, periodNumber, closeStatus]) => ({
        startDate,
        endDate,
        fiscalYear: 2025,
        periodNumber,
        status: "Inactive" as const,
        closeStatus,
        companyId: f.companyId,
        createdBy: "system"
      }))
    )
    .returning(["id", "periodNumber"])
    .execute();
  const idOf = (periodNumber: number) =>
    rows.find((row) => row.periodNumber === periodNumber)?.id;
  return { january: idOf(1), february: idOf(2) };
}

/** A closed entry dated `entryDate`. */
async function addTimeOn(
  f: Fixture,
  serviceJobId: string,
  args: { hours: number; entryDate: string }
) {
  const entry = await f.addTime(serviceJobId, { hours: args.hours });
  await f.db
    .updateTable("serviceJobTime")
    .set({ entryDate: args.entryDate })
    .where("id", "=", entry.id)
    .where("companyId", "=", f.companyId)
    .execute();
  return entry;
}

/** The job's time journals, oldest posting date first, with their lines. */
async function timeJournals(f: Fixture, serviceJobId: string) {
  const journals = await f.db
    .selectFrom("journal")
    .select(["id", "postingDate", "accountingPeriodId"])
    .where("companyId", "=", f.companyId)
    .where("id", "in", (eb) =>
      eb
        .selectFrom("journalLine")
        .select("journalId")
        .where("documentType", "=", "Service Job")
        .where("documentId", "=", serviceJobId)
        .where("companyId", "=", f.companyId)
    )
    .orderBy("postingDate")
    .execute();
  return Promise.all(
    journals.map(async (journal) => ({
      ...journal,
      lines: await f.journalLines(journal.id)
    }))
  );
}

async function companyToday(f: Fixture) {
  return datetime.today(await getCompanyTimeZone(f.db, f.companyId)).toString();
}

databaseTest(
  "an entry in an Open earlier month posts on its entry date",
  async () => {
    const f = await serviceJobFixture();
    try {
      const periods = await splitPeriods(f, "Open");
      const job = await jobFor(f);
      await addTimeOn(f, job.id, { hours: 1, entryDate: "2025-01-15" });

      await postTime(f, job.id);
      const journals = await timeJournals(f, job.id);
      expect(journals).toEqual([
        {
          id: expect.any(String),
          postingDate: "2025-01-15",
          accountingPeriodId: periods.january,
          lines: [
            [f.account("cost-of-service"), 40],
            [f.account("labor-absorption"), -40]
          ]
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

for (const closeStatus of ["Closed", "Locked"] as const) {
  databaseTest(
    `an entry in a ${closeStatus} period posts on today's date`,
    async () => {
      const f = await serviceJobFixture();
      try {
        await splitPeriods(f, closeStatus);
        const job = await jobFor(f);
        await addTimeOn(f, job.id, { hours: 1, entryDate: "2025-02-15" });

        await postTime(f, job.id);
        const journals = await timeJournals(f, job.id);
        expect(journals).toEqual([
          {
            id: expect.any(String),
            postingDate: await companyToday(f),
            accountingPeriodId: `${f.prefix}-period`,
            lines: [
              [f.account("cost-of-service"), 40],
              [f.account("labor-absorption"), -40]
            ]
          }
        ]);
      } finally {
        await f.cleanup();
      }
    }
  );
}

databaseTest(
  "entries on two dates post two journals, each balanced on its date",
  async () => {
    const f = await serviceJobFixture();
    try {
      const periods = await splitPeriods(f, "Open");
      const job = await jobFor(f);
      await addTimeOn(f, job.id, { hours: 1, entryDate: "2025-01-15" });
      await addTimeOn(f, job.id, { hours: 2, entryDate: "2025-02-10" });

      await postTime(f, job.id);
      const journals = await timeJournals(f, job.id);
      expect(
        journals.map((journal) => ({
          postingDate: journal.postingDate,
          accountingPeriodId: journal.accountingPeriodId,
          lines: journal.lines
        }))
      ).toEqual([
        {
          postingDate: "2025-01-15",
          accountingPeriodId: periods.january,
          lines: [
            [f.account("cost-of-service"), 40],
            [f.account("labor-absorption"), -40]
          ]
        },
        {
          postingDate: "2025-02-10",
          accountingPeriodId: periods.february,
          lines: [
            [f.account("cost-of-service"), 80],
            [f.account("labor-absorption"), -80]
          ]
        }
      ]);
      // Both accounts are Expense: a balanced journal sums to 0.
      for (const journal of journals) {
        const sum = journal.lines.reduce(
          (total, [, amount]) => total + Number(amount),
          0
        );
        expect(sum).toBe(0);
      }
    } finally {
      await f.cleanup();
    }
  }
);
