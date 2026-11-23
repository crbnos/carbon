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
} from "./fixtures/always-post";
import { issueMaterial as issue } from "../../app/modules/inventory/inventory.service";
import { TIME_ENTRY_BEFORE_CUTOVER_ERROR } from "~/modules/shared/shared.service";
import { databaseTest } from "./fixtures/local-database";
import { postMaintenanceEvent } from "../../app/modules/resources/resources.service";
import { postProductionEvent } from "../../app/modules/production/production.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { handlesOf } from "./fixtures/handles";

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
  "an operation backflush writes a Provisional journal before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);

      const before = await jobFixture(f, "1");
      const provisional = await newJournals(f, async () =>
        unwrap(
          await invokePosting(handlesOf(f.ctx), "issue", {
                        type: "jobOperation",
                        id: before.operationId,
                        quantity: 1
                      }, issue)
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
          await invokePosting(handlesOf(f.ctx), "issue", {
                        type: "jobOperation",
                        id: after.operationId,
                        quantity: 1
                      }, issue)
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
          await invokePosting(handlesOf(f.ctx), "post-production-event", { productionEventId: firstEvent }, postProductionEvent)
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
        const result = await invokePosting(handlesOf(f.ctx), "post-production-event", {
                  productionEventId: secondEvent
                }, postProductionEvent);
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
          await invokePosting(handlesOf(f.ctx), "post-production-event", { productionEventId: secondEvent }, postProductionEvent)
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
  "two posts of one production event at once absorb its cost once",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const workCenterId = await workCenterFixture(f);
      const job = await jobFixture(f, "1");
      const eventId = await laborEvent(f, job.operationId, workCenterId);

      // The OEE sync posts a sensor event as it ends it while an operation
      // finish posts the same event: the second must not add it again.
      const results: { error: { status: number } | null }[] = [];
      const journals = await newJournals(f, async () => {
        results.push(
          ...(await Promise.all([
            invokePosting(handlesOf(f.ctx), "post-production-event", { productionEventId: eventId }, postProductionEvent),
            invokePosting(handlesOf(f.ctx), "post-production-event", { productionEventId: eventId }, postProductionEvent)
          ]))
        );
      });

      const wip = (await journalLinesOf(f, journals))
        .filter((line) => line.accountId === f.account("wip"))
        .reduce((sum, line) => sum + line.amount, 0);
      expect(wip).toBe(60);
      for (const result of results) {
        if (result.error) expect(result.error.status).toBe(409);
      }
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "two reposts of one edited production event at once adjust it once",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const workCenterId = await workCenterFixture(f);
      const job = await jobFixture(f, "1");
      const eventId = await laborEvent(f, job.operationId, workCenterId);
      const posted = await newJournals(f, async () =>
        unwrap(await invokePosting(handlesOf(f.ctx), "post-production-event", { productionEventId: eventId }, postProductionEvent))
      );

      // Edited to two hours, then reposted by two callers at once. Both read
      // the same prior lines: the second must not reverse 60 and add 120
      // on top of the first's adjustment.
      await f.db
        .updateTable("productionEvent")
        .set({ startTime: sql<string>`now() - interval '2 hours'` })
        .where("id", "=", eventId)
        .execute();
      const results: { error: { status: number } | null }[] = [];
      const adjustments = await newJournals(f, async () => {
        results.push(
          ...(await Promise.all([
            invokePosting(handlesOf(f.ctx), "post-production-event", { productionEventId: eventId }, postProductionEvent),
            invokePosting(handlesOf(f.ctx), "post-production-event", { productionEventId: eventId }, postProductionEvent)
          ]))
        );
      });

      const wip = (await journalLinesOf(f, [...posted, ...adjustments]))
        .filter((line) => line.accountId === f.account("wip"))
        .reduce((sum, line) => sum + line.amount, 0);
      expect(wip).toBe(120);
      for (const result of results) {
        if (result.error) expect(result.error.status).toBe(409);
      }
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
          await invokePosting(handlesOf(f.ctx), "post-maintenance-event", { maintenanceDispatchIds: [first] }, postMaintenanceEvent)
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
        const result = await invokePosting(handlesOf(f.ctx), "post-maintenance-event", {
                  maintenanceDispatchIds: [second]
                }, postMaintenanceEvent);
        expect(result.error?.message).toBe(
          "Set the Labor & Machine Absorption account in Accounting → Default Accounts."
        );
      });
      expect(refused).toEqual([]);

      await setLaborAbsorption(f, f.account("labor-absorption"));
      const posted = await newJournals(f, async () =>
        unwrap(
          await invokePosting(handlesOf(f.ctx), "post-maintenance-event", {
                        maintenanceDispatchIds: [second]
                      }, postMaintenanceEvent)
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
          await invokePosting(handlesOf(f.ctx), "issue", {
                        type: "jobOperationScrap",
                        jobOperationId: job.operationId,
                        quantity: 1,
                        scrapReasonId: scrapReason.id
                      }, issue)
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
        unwrap(await invokePosting(handlesOf(f.ctx), "post-production-event", { productionEventId: eventId }, postProductionEvent))
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
          const result = await invokePosting(handlesOf(f.ctx), "post-production-event", {
                      productionEventId: eventId,
                      reverse
                    }, postProductionEvent);
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
          await invokePosting(handlesOf(f.ctx), "post-maintenance-event", {
                        maintenanceDispatchIds: [dispatchId]
                      }, postMaintenanceEvent)
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
          await invokePosting(handlesOf(f.ctx), "post-maintenance-event", {
                        maintenanceDispatchIds: [dispatchId]
                      }, postMaintenanceEvent)
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
          await invokePosting(handlesOf(f.ctx), "post-maintenance-event", {
                        maintenanceDispatchIds: [dispatchId]
                      }, postMaintenanceEvent)
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
        const result = await invokePosting(handlesOf(f.ctx), "post-maintenance-event", {
                  maintenanceDispatchIds: [dispatchId]
                }, postMaintenanceEvent);
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
