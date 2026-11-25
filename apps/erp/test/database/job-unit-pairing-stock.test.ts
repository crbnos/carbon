// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  assignShipmentSerial,
  filterStockShipmentSerials,
  issueMaterial
} from "../../app/modules/inventory/inventory.service";
import { triggerRework } from "../../app/modules/production/production.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  jobFixture,
  type Fixture,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf, systemServiceOf } from "./fixtures/handles";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import { confirmPackoutCommand, createPairedJob } from "./fixtures/paired-job";
import { receiveProductionPair } from "./fixtures/packout-production";
import {
  createPackedShipment,
  postPackedShipment,
  shipPackedUnit
} from "./fixtures/packout-shipment";

async function post(f: Fixture, input: Parameters<typeof issueMaterial>[1]) {
  return invokePosting(
    handlesOf(f.ctx),
    "issue",
    await confirmPackoutCommand(f, input),
    issueMaterial
  ).then(unwrap);
}

databaseTest(
  "a packed unit can ship or feed another job only after receipt books its stock and cost",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const prod = await receiveProductionPair(f);
      const job = await createPairedJob(f, prod.productionItemId);
      await post(f, {
        type: "trackedEntitiesToOperation",
        materialId: job.materialId,
        jobOperationId: job.operationId,
        parentTrackedEntityId: job.unitId,
        children: [{ trackedEntityId: prod.first.id!, quantity: 1 }]
      });
      await post(f, {
        type: "jobOperationSerialComplete",
        jobOperationId: job.operationId,
        trackedEntityId: job.unitId,
        quantity: 1
      });
      const ordinary = await f.db
        .insertInto("trackedEntity")
        .values({
          itemId: job.salesItemId,
          readableId: "ORDINARY",
          quantity: 1,
          status: "Available",
          sourceDocument: "Item",
          sourceDocumentId: job.salesItemId,
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await f.db
        .insertInto("itemLedger")
        .values({
          itemId: job.salesItemId,
          trackedEntityId: ordinary.id,
          entryType: "Positive Adjmt.",
          quantity: 1,
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      const candidates = [{ id: ordinary.id! }, { id: job.unitId }];
      const pickList = () =>
        filterStockShipmentSerials(f.db, f.companyId, candidates);
      expect(await pickList()).toEqual([candidates[0]]);
      await expect(
        shipPackedUnit(f, job.salesItemId, job.unitId)
      ).rejects.toThrow(/no stock to ship/);
      const next = await jobFixture(
        { ...f, partId: job.salesItemId },
        "downstream"
      );
      await f.db
        .updateTable("job")
        .set({ status: "Ready" })
        .where("id", "=", next.jobId)
        .where("companyId", "=", f.companyId)
        .execute();
      const nextOutput = await f.db
        .selectFrom("trackedEntity")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where(sql<boolean>`attributes->>'Job' = ${next.jobId}`)
        .executeTakeFirstOrThrow();
      const issueDownstream = () =>
        post(f, {
          type: "trackedEntitiesToOperation",
          materialId: next.materialId,
          jobOperationId: next.operationId,
          parentTrackedEntityId: nextOutput.id!,
          children: [{ trackedEntityId: job.unitId, quantity: 1 }]
        });
      await expect(issueDownstream()).rejects.toThrow(/receiv/i);
      const stockMoves = () =>
        f.db
          .selectFrom("itemLedger")
          .select(["quantity", "documentId"])
          .where("companyId", "=", f.companyId)
          .where("trackedEntityId", "=", job.unitId)
          .orderBy("entryNumber")
          .execute();
      expect(await stockMoves()).toEqual([]);
      const output = await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", job.unitId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(output.status).toBe("Available");
      await sql`SELECT receive_job_to_inventory(${job.jobId},1,${f.companyId},${USER},p_expected_serials => ARRAY[${prod.first.serial}]::text[])`.execute(
        f.db
      );
      expect(await pickList()).toEqual(candidates);
      await issueDownstream();
      expect(await stockMoves()).toEqual([
        { quantity: 1, documentId: job.jobId },
        { quantity: -1, documentId: next.jobId }
      ]);
      const received = await f.db
        .selectFrom("costLedger")
        .select(["cost", "remainingQuantity"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Receipt")
        .where("documentId", "=", job.jobId)
        .execute();
      expect(received).toEqual([{ cost: 20, remainingQuantity: 0 }]);
      const downstream = await f.db
        .selectFrom("costLedger")
        .select(["cost", "trackedEntityId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Consumption")
        .where("documentId", "=", next.jobId)
        .execute();
      expect(downstream).toEqual([{ cost: -20, trackedEntityId: job.unitId }]);
      const { rows } = await sql<{
        wip: number;
      }>`SELECT job_wip_balance(${next.jobId},${f.companyId}) AS wip`.execute(
        f.db
      );
      expect(Number(rows[0]!.wip)).toBe(20);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a reworked pack-out receives the actual unit only after its terminal rework is logged",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      await post(f, {
        type: "trackedEntitiesToOperation",
        jobOperationId: job.operationId,
        materialId: job.materialId,
        parentTrackedEntityId: job.unitId,
        children: [{ trackedEntityId: production.first.id!, quantity: 1 }]
      });
      const rework = await triggerRework(systemServiceOf(f.ctx, f.groupId), {
        jobId: job.jobId,
        triggeredAtJobOperationId: job.operationId,
        targetJobOperationId: job.operationId,
        reason: "Repeat the final pack-out check",
        quantity: 1,
        trackedEntityIds: [job.unitId]
      });
      const other = await f.db
        .selectFrom("trackedEntity")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", job.salesItemId)
        .where(sql<boolean>`attributes->>'Job' = ${job.jobId}`)
        .where("id", "!=", job.unitId)
        .executeTakeFirstOrThrow();
      await post(f, {
        type: "trackedEntitiesToOperation",
        jobOperationId: job.operationId,
        materialId: job.materialId,
        parentTrackedEntityId: other.id!,
        children: [{ trackedEntityId: production.second.id!, quantity: 1 }]
      });
      const ready = async () =>
        (
          await sql<{
            id: string;
          }>`SELECT id FROM job_receivable_paired_units(${job.jobId},${f.companyId}) AS ready(id)`.execute(
            f.db
          )
        ).rows;
      expect(await ready()).toEqual([]);
      await post(f, {
        type: "jobOperationSerialComplete",
        jobOperationId: rework.clonedOperationIds[0]!,
        trackedEntityId: job.unitId,
        quantity: 1
      });
      expect(await ready()).toEqual([{ id: job.unitId }]);
      await sql`SELECT receive_job_to_inventory(${job.jobId},1,${f.companyId},${USER},p_expected_serials => ARRAY[${production.first.serial}]::text[])`.execute(
        f.db
      );
      expect(await ready()).toEqual([]);
      const layers = await f.db
        .selectFrom("costLedger")
        .select(["trackedEntityId", "cost", "remainingQuantity"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", job.jobId)
        .where("documentType", "=", "Job Receipt")
        .execute();
      expect(layers).toEqual([
        { trackedEntityId: job.unitId, cost: 20, remainingQuantity: 1 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "sales stock posting accepts a legacy serial whose Item provenance identifies its SKU",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const id = production.first.id!;
      await f.db
        .updateTable("trackedEntity")
        .set({
          itemId: null,
          sourceDocument: "Item",
          sourceDocumentId: production.productionItemId
        })
        .where("companyId", "=", f.companyId)
        .where("id", "=", id)
        .execute();
      const legacy = await f.db
        .selectFrom("trackedEntity")
        .select("itemId")
        .where("id", "=", id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(legacy.itemId).toBeNull();
      const draft = await createPackedShipment(
        f,
        production.productionItemId,
        id
      );
      expect(
        await assignShipmentSerial(
          f.db,
          f.companyId,
          {
            shipmentId: draft.shipmentId,
            shipmentLineId: draft.shipmentLineId,
            trackedEntityId: id,
            index: 0
          },
          {
            itemId: null,
            status: "Available",
            receiptId: undefined,
            sourceDocument: "Sales Order",
            sourceDocumentId: draft.salesOrderId,
            supplierId: null
          }
        )
      ).toBeNull();
      await postPackedShipment(f, draft, production.productionItemId, id);
    } finally {
      await f.cleanup();
    }
  }
);

for (const shipFirst of [false, true]) {
  databaseTest(
    `a shipment racing a downstream issue can spend a received serial only once (${shipFirst ? "shipment" : "issue"} holds first lock)`,
    async () => {
      const f = await alwaysPostFixture();
      const shipDb = await connectLocalTestDatabase();
      const issueDb = await connectLocalTestDatabase();
      const pending: Promise<PromiseSettledResult<unknown>[]>[] = [];
      try {
        const production = await receiveProductionPair(f);
        const job = await createPairedJob(f, production.productionItemId, 1);
        await post(f, {
          type: "trackedEntitiesToOperation",
          jobOperationId: job.operationId,
          materialId: job.materialId,
          parentTrackedEntityId: job.unitId,
          children: [{ trackedEntityId: production.first.id!, quantity: 1 }]
        });
        await post(f, {
          type: "jobOperationSerialComplete",
          jobOperationId: job.operationId,
          trackedEntityId: job.unitId,
          quantity: 1
        });
        const next = await jobFixture(
          { ...f, partId: job.salesItemId },
          "downstream"
        );
        await f.db
          .updateTable("job")
          .set({ status: "Ready" })
          .where("companyId", "=", f.companyId)
          .where("id", "=", next.jobId)
          .execute();
        const output = await f.db
          .selectFrom("trackedEntity")
          .select("id")
          .where("companyId", "=", f.companyId)
          .where(sql<boolean>`attributes->>'Job'=${next.jobId}`)
          .executeTakeFirstOrThrow();
        const shipment = await createPackedShipment(
          f,
          job.salesItemId,
          job.unitId
        );
        expect(
          await assignShipmentSerial(
            f.db,
            f.companyId,
            {
              shipmentId: shipment.shipmentId,
              shipmentLineId: shipment.shipmentLineId,
              trackedEntityId: job.unitId,
              index: 0
            },
            {
              itemId: job.salesItemId,
              status: "Available",
              receiptId: undefined,
              sourceDocument: "Sales Order",
              sourceDocumentId: shipment.salesOrderId,
              supplierId: null
            }
          )
        ).toBeNull();
        const pid = async (db: Fixture["db"]) =>
          (
            await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
              db
            )
          ).rows[0]!.pid;
        const client = (db: Fixture["db"]) => ({
          ...f,
          db,
          ctx: { ...f.ctx, db }
        });
        for (const db of [shipDb, issueDb])
          await sql`SELECT set_config('app.sync_in_progress','false',false)`.execute(
            db
          );
        const issue = {
          pid: await pid(issueDb),
          call: () =>
            post(client(issueDb), {
              type: "trackedEntitiesToOperation",
              jobOperationId: next.operationId,
              materialId: next.materialId,
              parentTrackedEntityId: output.id!,
              children: [{ trackedEntityId: job.unitId, quantity: 1 }]
            })
        };
        const ship = {
          pid: await pid(shipDb),
          call: () =>
            postPackedShipment(
              client(shipDb),
              shipment,
              job.salesItemId,
              job.unitId
            )
        };
        await f.db.transaction().execute(async (trx) => {
          await trx
            .selectFrom("trackedEntity")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("id", "=", job.unitId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          for (const contender of shipFirst ? [ship, issue] : [issue, ship]) {
            pending.push(Promise.allSettled([contender.call()]));
            await expect
              .poll(
                async () =>
                  (
                    await sql<{
                      waiting: boolean;
                    }>`SELECT cardinality(pg_blocking_pids(${contender.pid}::int))>0 AS waiting`.execute(
                      trx
                    )
                  ).rows[0]!.waiting,
                { timeout: 7000 }
              )
              .toBe(true);
          }
        });
        const [winner, loser] = (await Promise.all(pending)).flat();
        if (winner?.status === "rejected") throw winner.reason;
        expect(loser?.status).toBe("rejected");
        if (loser?.status === "rejected")
          expect(loser.reason.message).toMatch(
            shipFirst
              ? /not available|already consumed/i
              : /selected serial.*changed|has no stock to ship at this location/i
          );
        const layer = await f.db
          .selectFrom("costLedger")
          .select(["cost", "remainingQuantity"])
          .where("companyId", "=", f.companyId)
          .where("documentType", "=", "Job Receipt")
          .where("trackedEntityId", "=", job.unitId)
          .executeTakeFirstOrThrow();
        expect(layer).toEqual({ cost: 20, remainingQuantity: 0 });
        const movements = await f.db
          .selectFrom("itemLedger")
          .select(["documentType", "quantity"])
          .where("companyId", "=", f.companyId)
          .where("trackedEntityId", "=", job.unitId)
          .orderBy("entryNumber")
          .execute();
        expect(movements).toEqual([
          { documentType: "Job Receipt", quantity: 1 },
          {
            documentType: shipFirst ? "Sales Shipment" : "Job Consumption",
            quantity: -1
          }
        ]);
        const cogs = (
          await sql<{
            value: number;
          }>`SELECT coalesce(sum(amount),0) AS value FROM "journalLine"
        WHERE "documentId"=${shipment.shipmentId} AND "accountId"=${f.account("cogs")} AND "companyId"=${f.companyId}`.execute(
            f.db
          )
        ).rows[0]!.value;
        const wip = (
          await sql<{
            value: number;
          }>`SELECT job_wip_balance(${next.jobId},${f.companyId}) AS value`.execute(
            f.db
          )
        ).rows[0]!.value;
        expect([Number(cogs), Number(wip)]).toEqual(
          shipFirst ? [20, 0] : [0, 20]
        );
      } finally {
        await Promise.all(pending);
        await shipDb.destroy();
        await issueDb.destroy();
        await f.cleanup();
      }
    }
  );
}
