// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { issueMaterial } from "../../app/modules/inventory/inventory.service";
import { getJobReceiptSnapshot } from "../../app/modules/production/production.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import { createPairedJob } from "./fixtures/paired-job";
import { receiveProductionPair } from "./fixtures/packout-production";
import { shipPackedUnit } from "./fixtures/packout-shipment";

function post(f: Fixture, input: Parameters<typeof issueMaterial>[1]) {
  return invokePosting(handlesOf(f.ctx), "issue", input, issueMaterial).then(
    unwrap
  );
}

databaseTest(
  "a corrected serial survives an overlapping ERP receipt, a partial receipt and a stock shipment",
  async () => {
    const f = await alwaysPostFixture();
    let peer: Fixture["db"] | undefined;
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      const issue = (source: string, output: string) =>
        post(f, {
          type: "trackedEntitiesToOperation",
          materialId: job.materialId,
          jobOperationId: job.operationId,
          parentTrackedEntityId: output,
          children: [{ trackedEntityId: source, quantity: 1 }]
        });
      const undo = (source: string) =>
        post(f, {
          type: "unconsumeTrackedEntities",
          materialId: job.materialId,
          parentTrackedEntityId: job.unitId,
          children: [{ trackedEntityId: source, quantity: 1 }]
        });
      const log = (output: string) =>
        post(f, {
          type: "jobOperationSerialComplete",
          jobOperationId: job.operationId,
          trackedEntityId: output,
          quantity: 1
        });
      const receive = (quantity: number) =>
        sql<{ completed: boolean }>`SELECT receive_job_to_inventory(
      ${job.jobId}, ${quantity}::numeric, ${f.companyId}, ${USER}) AS completed`.execute(
          f.db
        );
      const finish = () =>
        f.db
          .updateTable("jobOperation")
          .set({ status: "Done", updatedBy: USER })
          .where("id", "=", job.operationId)
          .where("companyId", "=", f.companyId)
          .returning("id")
          .executeTakeFirstOrThrow();

      await expect(finish()).rejects.toThrow(/Finish requires/i);
      await issue(production.first.id!, job.unitId);
      await undo(production.first.id!);
      await issue(production.second.id!, job.unitId);
      const blank = await f.db
        .selectFrom("trackedEntity")
        .select(["id", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", job.salesItemId)
        .where(sql<boolean>`attributes->>'Job' = ${job.jobId}`)
        .where("readableId", "is", null)
        .executeTakeFirstOrThrow();
      expect(blank.quantity).toBe(1);
      const {
        rows: [mes]
      } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
        f.db
      );
      peer = await connectLocalTestDatabase();
      await sql`SELECT set_config('app.sync_in_progress','false',false)`.execute(
        peer
      );
      let completing: Promise<unknown> | undefined;
      try {
        await expect(
          peer.transaction().execute(async (trx) => {
            await trx
              .selectFrom("job")
              .select("id")
              .where("companyId", "=", f.companyId)
              .where("id", "=", job.jobId)
              .forUpdate()
              .executeTakeFirstOrThrow();
            completing = log(job.unitId);
            // Install a rejection handler while the peer transaction still holds the lock.
            void completing.catch(() => {});
            await expect
              .poll(
                async () => {
                  const {
                    rows: [r]
                  } = await sql<{ blocked: boolean }>`
          SELECT pg_backend_pid() = ANY(pg_blocking_pids(${mes!.pid})) AS blocked`.execute(
                    trx
                  );
                  return r!.blocked;
                },
                { timeout: 5000 }
              )
              .toBe(true);
            await sql`SELECT complete_job_to_inventory(${job.jobId},2,NULL,${f.locationId},${f.companyId},${USER})`.execute(
              trx
            );
          })
        ).rejects.toThrow(/completed paired units?/i);
      } finally {
        await completing;
      }
      await expect(receive(2)).rejects.toThrow(/completed paired units?/i);
      await expect(finish()).rejects.toThrow(/Finish requires/i);
      const snapshot = await getJobReceiptSnapshot(
        f.db,
        job.jobId,
        f.companyId
      );
      expect(snapshot?.pairedSerials).toEqual([production.second.serial]);
      // A stale dialog showed the corrected-away serial. Refusing its receipt
      // must also roll back the ledger row for the different serial now ready.
      await expect(
        sql`SELECT receive_job_to_inventory(${job.jobId}, 1, ${f.companyId}, ${USER},
        p_expected_serials => ARRAY[${production.first.serial}]::text[])`.execute(
          f.db
        )
      ).rejects.toThrow(/Reopen the job receipt/);
      expect(
        (await getJobReceiptSnapshot(f.db, job.jobId, f.companyId))
          ?.trackedEntityIds
      ).toEqual([]);

      expect((await receive(1)).rows).toEqual([{ completed: false }]);
      expect((await receive(1)).rows).toEqual([{ completed: false }]);
      await expect(undo(production.second.id!)).rejects.toThrow(/received/i);
      const firstShipment = await shipPackedUnit(
        f,
        job.salesItemId,
        job.unitId
      );
      const cogs = await f.db
        .selectFrom("journalLine")
        .select("amount")
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", firstShipment.shipmentId)
        .where("accountId", "=", f.account("cogs"))
        .execute();
      expect(cogs).toEqual([{ amount: 20 }]);
      await issue(production.first.id!, blank.id!);
      await log(blank.id!);
      await finish();
      const header = await f.db
        .selectFrom("job")
        .select(["status", "quantityReceivedToInventory"])
        .where("companyId", "=", f.companyId)
        .where("id", "=", job.jobId)
        .executeTakeFirstOrThrow();
      expect(header).toEqual({
        status: "Completed",
        quantityReceivedToInventory: 2
      });
      expect((await receive(2)).rows).toEqual([{ completed: true }]);
      const receipts = await f.db
        .selectFrom("itemLedger as il")
        .innerJoin("trackedEntity as te", "te.id", "il.trackedEntityId")
        .select(["te.id", "te.readableId", "il.quantity"])
        .where("il.companyId", "=", f.companyId)
        .where("il.documentId", "=", job.jobId)
        .where("il.documentType", "=", "Job Receipt")
        .orderBy("te.readableId")
        .execute();
      expect(receipts).toEqual([
        { id: blank.id, readableId: production.first.serial, quantity: 1 },
        { id: job.unitId, readableId: production.second.serial, quantity: 1 }
      ]);
      const pairing = await f.db
        .selectFrom("jobUnitPairing")
        .select(["sourceId", "outputId"])
        .where("companyId", "=", f.companyId)
        .where("jobId", "=", job.jobId)
        .where("releasedAt", "is", null)
        .orderBy("serial")
        .execute();
      expect(pairing).toEqual([
        { sourceId: production.first.id, outputId: blank.id },
        { sourceId: production.second.id, outputId: job.unitId }
      ]);
      const trace = await sql<{
        id: string;
        job: string;
      }>`SELECT id, attributes->>'Job' as job FROM
      get_direct_descendants_of_tracked_entities_strict(ARRAY[${job.unitId}]::text[],${f.companyId})`.execute(
        f.db
      );
      expect(trace.rows).toContainEqual({
        id: production.second.id,
        job: production.jobId
      });
    } finally {
      await peer?.destroy();
      await f.cleanup();
    }
  }
);

databaseTest(
  "ERP validates after a competing MES completion releases the job lock",
  async () => {
    const f = await alwaysPostFixture();
    const erp = await connectLocalTestDatabase();
    const observer = await connectLocalTestDatabase();
    const pending: Promise<PromiseSettledResult<unknown>[]>[] = [];
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      await post(f, {
        type: "trackedEntitiesToOperation",
        materialId: job.materialId,
        jobOperationId: job.operationId,
        parentTrackedEntityId: job.unitId,
        children: [{ trackedEntityId: production.first.id!, quantity: 1 }]
      });
      const pid = async (db: Fixture["db"]) =>
        (await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(db))
          .rows[0]!.pid;
      const [mesPid, erpPid, observerPid] = await Promise.all([
        pid(f.db),
        pid(erp),
        pid(observer)
      ]);
      await observer.transaction().execute(async (trx) => {
        // Pause the native MES transaction just after it acquired the job lock.
        await trx
          .selectFrom("trackedEntity")
          .select("id")
          .where("id", "=", job.unitId)
          .where("companyId", "=", f.companyId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const blocked = async (holder: number, waiter: number) =>
          (
            await sql<{ v: boolean }>`
        SELECT ${holder}::int = ANY(pg_blocking_pids(${waiter})) AS v`.execute(
              trx
            )
          ).rows[0]!.v;
        pending.push(
          Promise.allSettled([
            post(f, {
              type: "jobOperationSerialComplete",
              jobOperationId: job.operationId,
              trackedEntityId: job.unitId,
              quantity: 1
            })
          ])
        );
        await expect
          .poll(() => blocked(observerPid, mesPid), { timeout: 5000 })
          .toBe(true);
        pending.push(
          Promise.allSettled([
            sql`SELECT complete_job_to_inventory(${job.jobId},2,NULL,${f.locationId},${f.companyId},${USER})`.execute(
              erp
            )
          ])
        );
        await expect
          .poll(() => blocked(mesPid, erpPid), { timeout: 5000 })
          .toBe(true);
      });
      const [finished, receipt] = (await Promise.all(pending)).flat();
      if (finished?.status === "rejected") throw finished.reason;
      expect(receipt).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({
          message: expect.stringContaining("Only 1 completed paired unit")
        })
      });
      const snapshot = await getJobReceiptSnapshot(
        f.db,
        job.jobId,
        f.companyId
      );
      expect(snapshot?.trackedEntityIds).toEqual([]);
      expect(snapshot?.pairedSerials).toEqual([production.first.serial]);
    } finally {
      await Promise.all(pending);
      await observer.destroy();
      await erp.destroy();
      await f.cleanup();
    }
  }
);
