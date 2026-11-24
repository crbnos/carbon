// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  filterStockShipmentSerials,
  issueMaterial
} from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  jobFixture,
  type Fixture,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";
import { createPairedJob } from "./fixtures/paired-job";
import { receiveProductionPair } from "./fixtures/packout-production";
import { shipPackedUnit } from "./fixtures/packout-shipment";

function post(f: Fixture, input: Parameters<typeof issueMaterial>[1]) {
  return invokePosting(handlesOf(f.ctx), "issue", input, issueMaterial).then(
    unwrap
  );
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
      await sql`SELECT complete_job_to_inventory(${job.jobId},1::numeric,NULL,${f.locationId},${f.companyId},${USER})`.execute(
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
