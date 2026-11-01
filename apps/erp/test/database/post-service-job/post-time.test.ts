// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { journalReference } from "@carbon/database";
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
