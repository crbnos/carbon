// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

import {
  alwaysPostFixture,
  expectPostedJournals,
  expectProvisionalJournals,
  type Fixture,
  jobFixture,
  journalLinesOf,
  newJournals,
  stampCutover,
  stockPart,
  unwrap
} from "./fixtures/always-post";
import { issueMaterial as issue } from "../../app/modules/inventory/inventory.service";
import { databaseTest } from "./fixtures/local-database";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  closeJob,
  postProductionEvent
} from "../../app/modules/production/production.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { handlesOf } from "./fixtures/handles";
import { projectPostingFixture } from "./fixtures/project-posting";

/** Issues the job's two parts to its operation by hand. */
async function issueTwoParts(
  f: Fixture,
  job: Awaited<ReturnType<typeof jobFixture>>
) {
  unwrap(
    await invokePosting(handlesOf(f.ctx), "issue", {
            type: "partToOperation",
            id: job.operationId,
            itemId: f.partId,
            materialId: job.materialId,
            quantity: 2,
            adjustmentType: "Negative Adjmt."
          }, issue)
  );
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
        await closeJob(f.service, { jobId: before.jobId })
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
        await closeJob(f.service, { jobId: after.jobId })
      );
      await expectPostedJournals(f, posted, "Job Close", periodId);
    } finally {
      await f.cleanup();
    }
  }
);

/** The WIP balance of a job: every WIP line documented against it. */
async function wipOf(
  f: Awaited<ReturnType<typeof projectPostingFixture>>,
  jobId: string
) {
  const row = await f.db
    .selectFrom("journalLine")
    .select((eb) => eb.fn.sum<number>("amount").as("balance"))
    .where("companyId", "=", f.companyId)
    .where("accountId", "=", f.account("wip"))
    .where("documentId", "=", jobId)
    .executeTakeFirstOrThrow();
  return Number(row.balance ?? 0);
}

databaseTest(
  "closing a consume-to-project job on a Contract project leaves the project's cost on Project WIP",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      // The backfilled default: Project WIP is the WIP account.
      await f.db
        .updateTable("accountDefault")
        .set({ projectWorkInProgressAccount: f.account("wip") })
        .where("companyId", "=", f.companyId)
        .execute();
      const { itemId, locationId } = await f.addStockedItem("bolt", {
        quantity: 10,
        unitCost: 10
      });
      const job = await f.addConsumeToProjectJob("a", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 3,
        jobQuantity: 1
      });

      // 30 of material to the project.
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "issue",
          { type: "jobOperation", id: job.operationId, quantity: 1 },
          issue
        )
      );
      // 100 of labor to the project (2 h at 50).
      const event = await f.db
        .insertInto("productionEvent")
        .values({
          jobOperationId: job.operationId,
          type: "Labor",
          startTime: "2026-10-05T08:00:00Z",
          endTime: "2026-10-05T10:00:00Z",
          employeeId: "system",
          workCenterId: job.workCenterId,
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const posted = unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-production-event",
          { productionEventId: event.id },
          postProductionEvent
        )
      );
      expect(posted.success).toBe(true);

      // Another 100 of labor, never posted on its own: completion posts it
      // in SQL (complete_job_to_inventory), with its projectLedger row.
      await f.db
        .insertInto("productionEvent")
        .values({
          jobOperationId: job.operationId,
          type: "Labor",
          startTime: "2026-10-06T08:00:00Z",
          endTime: "2026-10-06T10:00:00Z",
          employeeId: "system",
          workCenterId: job.workCenterId,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      await sql`
        SELECT complete_job_to_inventory(
          ${job.jobId}, 1, NULL, ${locationId}, ${f.companyId}, 'system'
        )
      `.execute(f.db);

      expect(await wipOf(f, job.jobId)).toEqual(230);

      await closeJob(f.service, { jobId: job.jobId });

      const variance = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Close")
        .where("documentId", "=", job.jobId)
        .execute();
      expect(variance).toEqual([]);

      // The project's cost is still on Project WIP, equal to its ledger.
      const ledger = await f.db
        .selectFrom("projectLedger")
        .select((eb) => eb.fn.sum<number>("amount").as("amount"))
        .where("companyId", "=", f.companyId)
        .where("jobId", "=", job.jobId)
        .executeTakeFirstOrThrow();
      expect(Number(ledger.amount)).toEqual(230);
      expect(await wipOf(f, job.jobId)).toEqual(230);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "closing a capital job still clears its WIP, project rows and all",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { fixedAssetId } = await f.addCapitalAsset({
        status: "Under Construction",
        finalAssetElement: true
      });
      const { itemId, locationId } = await f.addStockedItem("bracket", {
        quantity: 10,
        unitCost: 10
      });
      const job = await f.addConsumeToProjectJob("cap", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 3,
        jobQuantity: 1,
        consumeToProject: false
      });
      await f.db
        .updateTable("job")
        .set({
          projectId: f.projectId,
          projectElementId: f.elementId,
          fixedAssetId
        })
        .where("id", "=", job.jobId)
        .where("companyId", "=", f.companyId)
        .execute();
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "issue",
          { type: "jobOperation", id: job.operationId, quantity: 1 },
          issue
        )
      );
      // The capital job's material sits on WIP with a projectLedger row.
      const rows = await f.db
        .selectFrom("projectLedger")
        .select("journalLineId")
        .where("companyId", "=", f.companyId)
        .where("jobId", "=", job.jobId)
        .execute();
      expect(rows).toHaveLength(1);
      expect(await wipOf(f, job.jobId)).toEqual(30);

      await closeJob(f.service, { jobId: job.jobId });

      const variance = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Close")
        .where("documentId", "=", job.jobId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        variance.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("misc"), 30],
        [f.account("wip"), -30]
      ]);
      expect(await wipOf(f, job.jobId)).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);
