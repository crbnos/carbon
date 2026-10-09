// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Production postings against the live database, before and after the
// company's accounting cutover. Before it, each journal is Provisional with no
// accounting period and no period is created; after it, the same posting is
// Posted in the period of the posting date. An empty labor absorption default
// becomes a stand-in line on retained earnings before the cutover and refuses
// the posting after it.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  alwaysPostFixture,
  expectPostedJournals,
  expectProvisionalJournals,
  type Fixture,
  jobFixture,
  journalLinesOf,
  newJournals,
  seed,
  stampCutover,
  stockPart,
  USER,
  unwrap,
  workCenterFixture
} from "./always-post-test-fixture";
import closeJob from "./close-job";
import issue from "./issue";
import { TIME_ENTRY_BEFORE_CUTOVER_ERROR } from "./lib/cutover-void";
import { databaseTest } from "./local-database-test-fixture";
import postMaintenanceEvent from "./post-maintenance-event";
import postProductionEvent from "./post-production-event";

/** Issues the job's two parts to its operation by hand. */
async function issueTwoParts(
  f: Fixture,
  job: Awaited<ReturnType<typeof jobFixture>>
) {
  unwrap(
    await issue(f.ctx, {
      type: "partToOperation",
      id: job.operationId,
      itemId: f.partId,
      materialId: job.materialId,
      quantity: 2,
      adjustmentType: "Negative Adjmt."
    })
  );
}

/** A completed one-hour labor event on the job's operation. */
async function laborEvent(
  f: Fixture,
  operationId: string,
  workCenterId: string
): Promise<string> {
  const event = await f.db
    .insertInto("productionEvent")
    .values({
      jobOperationId: operationId,
      type: "Labor",
      startTime: sql<string>`now() - interval '1 hour'`,
      endTime: sql<string>`now()`,
      workCenterId,
      employeeId: USER,
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return event.id;
}

/** A maintenance dispatch with one completed one-hour labor entry. */
async function maintenanceDispatch(
  f: Fixture,
  workCenterId: string,
  key: string
): Promise<string> {
  const dispatch = await f.db
    .insertInto("maintenanceDispatch")
    .values({
      maintenanceDispatchId: `MD-${key}`,
      severity: "Preventive",
      locationId: f.locationId,
      workCenterId,
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await f.db
    .insertInto("maintenanceDispatchEvent")
    .values({
      maintenanceDispatchId: dispatch.id,
      employeeId: USER,
      workCenterId,
      startTime: sql<string>`now() - interval '1 hour'`,
      endTime: sql<string>`now()`,
      companyId: f.companyId,
      createdBy: USER
    })
    .execute();
  return dispatch.id;
}

async function setLaborAbsorption(f: Fixture, accountId: string | null) {
  await f.db
    .updateTable("accountDefault")
    .set({ laborAbsorptionAccount: accountId })
    .where("companyId", "=", f.companyId)
    .execute();
}

databaseTest(
  "close-job writes a Provisional variance before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);

      // Before the cutover: 20 of material in WIP, written off on close.
      const before = await jobFixture(f, "1");
      await issueTwoParts(f, before);
      const provisional = await newJournals(f, async () =>
        unwrap(await closeJob(f.ctx, { jobId: before.jobId }))
      );
      await expectProvisionalJournals(f, provisional, "Job Close");
      expect(await journalLinesOf(f, provisional)).toEqual([
        {
          accountId: f.account("filler"),
          amount: 20,
          accountDefaultRole: null,
          documentType: "Job Close"
        },
        {
          accountId: f.account("wip"),
          amount: -20,
          accountDefaultRole: null,
          documentType: "Job Close"
        }
      ]);

      // After the cutover: the same close posts in the current period.
      const periodId = await stampCutover(f);
      const after = await jobFixture(f, "2");
      await issueTwoParts(f, after);
      const posted = await newJournals(f, async () =>
        unwrap(await closeJob(f.ctx, { jobId: after.jobId }))
      );
      await expectPostedJournals(f, posted, "Job Close", periodId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an operation backflush writes a Provisional journal before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);

      const before = await jobFixture(f, "1");
      const provisional = await newJournals(f, async () =>
        unwrap(
          await issue(f.ctx, {
            type: "jobOperation",
            id: before.operationId,
            quantity: 1
          })
        )
      );
      await expectProvisionalJournals(f, provisional, "Job Consumption");
      const material = await f.db
        .selectFrom("jobMaterial")
        .select("quantityIssued")
        .where("id", "=", before.materialId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(material.quantityIssued)).toBe(2);

      const periodId = await stampCutover(f);
      const after = await jobFixture(f, "2");
      const posted = await newJournals(f, async () =>
        unwrap(
          await issue(f.ctx, {
            type: "jobOperation",
            id: after.operationId,
            quantity: 1
          })
        )
      );
      await expectPostedJournals(f, posted, "Job Consumption", periodId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a production event posts a labor absorption stand-in before the cutover and refuses an empty default after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const workCenterId = await workCenterFixture(f);
      const job = await jobFixture(f, "1");

      // Before the cutover, with no labor absorption default: one hour at 60
      // to WIP, the absorption side on retained earnings naming its role.
      const firstEvent = await laborEvent(f, job.operationId, workCenterId);
      const provisional = await newJournals(f, async () => {
        const result = unwrap(
          await postProductionEvent(f.ctx, { productionEventId: firstEvent })
        );
        expect(result).toEqual({ success: true });
      });
      await expectProvisionalJournals(f, provisional, "Production Event");
      expect(await journalLinesOf(f, provisional)).toEqual([
        {
          accountId: f.account("retained-earnings"),
          amount: -60,
          accountDefaultRole: "laborAbsorptionAccount",
          documentType: "Production Event"
        },
        {
          accountId: f.account("wip"),
          amount: 60,
          accountDefaultRole: null,
          documentType: "Production Event"
        }
      ]);

      // After the cutover the empty default refuses the posting.
      const periodId = await stampCutover(f);
      const secondEvent = await laborEvent(f, job.operationId, workCenterId);
      const refused = await newJournals(f, async () => {
        const result = await postProductionEvent(f.ctx, {
          productionEventId: secondEvent
        });
        expect(result.error?.message).toBe(
          "Set the Labor & Machine Absorption account in Accounting → Default Accounts."
        );
        expect(result.error?.status).toBe(400);
      });
      expect(refused).toEqual([]);

      // With the default set, the same event posts in the current period.
      await setLaborAbsorption(f, f.account("labor-absorption"));
      const posted = await newJournals(f, async () =>
        unwrap(
          await postProductionEvent(f.ctx, { productionEventId: secondEvent })
        )
      );
      await expectPostedJournals(f, posted, "Production Event", periodId);
      expect(await journalLinesOf(f, posted)).toEqual([
        {
          accountId: f.account("labor-absorption"),
          amount: -60,
          accountDefaultRole: null,
          documentType: "Production Event"
        },
        {
          accountId: f.account("wip"),
          amount: 60,
          accountDefaultRole: null,
          documentType: "Production Event"
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a maintenance event posts a labor absorption stand-in before the cutover and refuses an empty default after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const workCenterId = await workCenterFixture(f);

      const first = await maintenanceDispatch(f, workCenterId, "1");
      const provisional = await newJournals(f, async () =>
        unwrap(
          await postMaintenanceEvent(f.ctx, { maintenanceDispatchIds: [first] })
        )
      );
      await expectProvisionalJournals(f, provisional, "Maintenance Event");
      expect(await journalLinesOf(f, provisional)).toEqual([
        {
          accountId: f.account("filler"),
          amount: 60,
          accountDefaultRole: null,
          documentType: "Maintenance Event"
        },
        {
          accountId: f.account("retained-earnings"),
          amount: -60,
          accountDefaultRole: "laborAbsorptionAccount",
          documentType: "Maintenance Event"
        }
      ]);

      const periodId = await stampCutover(f);
      const second = await maintenanceDispatch(f, workCenterId, "2");
      const refused = await newJournals(f, async () => {
        const result = await postMaintenanceEvent(f.ctx, {
          maintenanceDispatchIds: [second]
        });
        expect(result.error?.message).toBe(
          "Set the Labor & Machine Absorption account in Accounting → Default Accounts."
        );
      });
      expect(refused).toEqual([]);

      await setLaborAbsorption(f, f.account("labor-absorption"));
      const posted = await newJournals(f, async () =>
        unwrap(
          await postMaintenanceEvent(f.ctx, {
            maintenanceDispatchIds: [second]
          })
        )
      );
      await expectPostedJournals(f, posted, "Maintenance Event", periodId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an operation scrap with no scrap account default posts to the variance account before the cutover",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: null })
        .where("companyId", "=", f.companyId)
        .execute();
      const scrapReason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();
      await stockPart(f, 10);
      const job = await jobFixture(f, "1");

      // Scrapping one assembly backflushes its two parts into WIP, then
      // relieves their 20 from WIP to the scrap account.
      const journals = await newJournals(f, async () =>
        unwrap(
          await issue(f.ctx, {
            type: "jobOperationScrap",
            jobOperationId: job.operationId,
            quantity: 1,
            scrapReasonId: scrapReason.id
          })
        )
      );
      await expectProvisionalJournals(f, journals, "Job Consumption");
      const scrapLines = (await journalLinesOf(f, journals)).filter(
        (line) => line.documentType === "Scrap"
      );
      expect(scrapLines).toEqual([
        {
          accountId: f.account("adjustment-variance"),
          amount: 20,
          accountDefaultRole: null,
          documentType: "Scrap"
        },
        {
          accountId: f.account("wip"),
          amount: -20,
          accountDefaultRole: null,
          documentType: "Scrap"
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

/** What the enable does to the journals of `journalIds`, dated before the
 *  cutover: it supersedes them and stamps the cutover. */
async function enableOver(f: Fixture, journalIds: string[]) {
  await seed(f, async (trx) => {
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx
      .updateTable("journal")
      .set({ status: "Superseded" })
      .where("id", "in", journalIds)
      .where("companyId", "=", f.companyId)
      .execute();
  });
  const periodId = await stampCutover(f);
  await setLaborAbsorption(f, f.account("labor-absorption"));
  return periodId;
}

databaseTest(
  "a production event posted before the cutover refuses a re-post or a reversal after the enable",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const workCenterId = await workCenterFixture(f);
      const job = await jobFixture(f);
      const eventId = await laborEvent(f, job.operationId, workCenterId);
      const provisional = await newJournals(f, async () =>
        unwrap(await postProductionEvent(f.ctx, { productionEventId: eventId }))
      );
      await expectProvisionalJournals(f, provisional, "Production Event");
      await enableOver(
        f,
        provisional.map((journal) => journal.id)
      );

      // The event is edited to two hours. Its superseded journal is not a
      // chain the re-post can reverse, so posting it again would add 120 to a
      // WIP the opening journal already opened with 60.
      await f.db
        .updateTable("productionEvent")
        .set({ startTime: sql<string>`now() - interval '2 hours'` })
        .where("id", "=", eventId)
        .execute();
      const refused = await newJournals(f, async () => {
        for (const reverse of [false, true]) {
          const result = await postProductionEvent(f.ctx, {
            productionEventId: eventId,
            reverse
          });
          expect(result.error).toMatchObject({
            status: 400,
            message: TIME_ENTRY_BEFORE_CUTOVER_ERROR
          });
        }
      });
      expect(refused).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a maintenance dispatch posted before the cutover posts only new time after the enable, and refuses an edit of the old",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const workCenterId = await workCenterFixture(f);
      const dispatchId = await maintenanceDispatch(f, workCenterId, "1");
      const provisional = await newJournals(f, async () =>
        unwrap(
          await postMaintenanceEvent(f.ctx, {
            maintenanceDispatchIds: [dispatchId]
          })
        )
      );
      await expectProvisionalJournals(f, provisional, "Maintenance Event");
      const periodId = await enableOver(
        f,
        provisional.map((journal) => journal.id)
      );

      // A reconcile with nothing new posts nothing: the opening journal
      // already holds the hour posted before the cutover.
      const unchanged = await newJournals(f, async () =>
        unwrap(
          await postMaintenanceEvent(f.ctx, {
            maintenanceDispatchIds: [dispatchId]
          })
        )
      );
      expect(unchanged).toEqual([]);

      // A second hour after the cutover posts only itself.
      await f.db
        .insertInto("maintenanceDispatchEvent")
        .values({
          maintenanceDispatchId: dispatchId,
          employeeId: USER,
          workCenterId,
          startTime: sql<string>`now() - interval '1 hour'`,
          endTime: sql<string>`now()`,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      const added = await newJournals(f, async () =>
        unwrap(
          await postMaintenanceEvent(f.ctx, {
            maintenanceDispatchIds: [dispatchId]
          })
        )
      );
      await expectPostedJournals(f, added, "Maintenance Event", periodId);
      expect(
        (await journalLinesOf(f, added)).map((line) => Number(line.amount))
      ).toEqual([60, -60]);

      // An edit of the hour posted before the cutover is refused.
      const [oldEntry] = await f.db
        .selectFrom("maintenanceDispatchEvent")
        .select("id")
        .where("maintenanceDispatchId", "=", dispatchId)
        .orderBy("createdAt")
        .limit(1)
        .execute();
      await f.db
        .updateTable("maintenanceDispatchEvent")
        .set({ startTime: sql<string>`now() - interval '3 hours'` })
        .where("id", "=", oldEntry!.id)
        .execute();
      const refused = await newJournals(f, async () => {
        const result = await postMaintenanceEvent(f.ctx, {
          maintenanceDispatchIds: [dispatchId]
        });
        expect(result.error).toMatchObject({
          status: 400,
          message: TIME_ENTRY_BEFORE_CUTOVER_ERROR
        });
      });
      expect(refused).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);
