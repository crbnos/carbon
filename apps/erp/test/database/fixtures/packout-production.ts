// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { issueMaterial } from "../../../app/modules/inventory/inventory.service";
import { assignSerialNumbers } from "../../../app/modules/production/production.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import {
  type Fixture,
  jobFixture,
  seed,
  stockPart,
  USER,
  unwrap
} from "./always-post";
import { handlesOf } from "./handles";

/** Make two serialized assemblies with two $10 brackets in each. */
export async function receiveProductionPair(f: Fixture) {
  const productionItemId = f.assemblyId;
  await seed(f, async (trx) => {
    await trx
      .updateTable("item")
      .set({ itemTrackingType: "Serial" })
      .where("id", "=", productionItemId)
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .insertInto("itemSerialSequence")
      .values({
        itemId: productionItemId,
        prefix: "SN-",
        suffix: "",
        next: 122,
        size: 3,
        step: 1,
        serialNumberTiming: "jobCreation",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });

  const job = await jobFixture(f, "serialized-production");
  await seed(f, async (trx) => {
    await trx
      .updateTable("job")
      .set({ status: "Ready", quantity: 2 })
      .where("id", "=", job.jobId)
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .updateTable("jobOperation")
      .set({ status: "Ready", operationQuantity: 2 })
      .where("id", "=", job.operationId)
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .updateTable("jobMaterial")
      .set({ estimatedQuantity: 4 })
      .where("id", "=", job.materialId)
      .where("companyId", "=", f.companyId)
      .execute();
  });
  const numbering = await assignSerialNumbers(f.service, { jobId: job.jobId });
  expect(numbering.assigned).toBe(2);
  const units = await f.db
    .selectFrom("trackedEntity")
    .select(["id", "readableId as serial"])
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", productionItemId)
    .where(sql<boolean>`attributes->>'Job' = ${job.jobId}`)
    .where("readableId", "is not", null)
    .$narrowType<{ serial: string }>()
    .orderBy("readableId")
    .execute();
  expect(units.map((unit) => unit.serial)).toEqual(["SN-123", "SN-124"]);

  await stockPart(f, 4);
  unwrap(
    await invokePosting(
      handlesOf(f.ctx),
      "issue",
      {
        type: "partToOperation",
        id: job.operationId,
        itemId: f.partId,
        materialId: job.materialId,
        quantity: 4,
        adjustmentType: "Negative Adjmt."
      },
      issueMaterial
    )
  );
  for (const unit of units) {
    unwrap(
      await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "jobOperationSerialComplete",
          jobOperationId: job.operationId,
          trackedEntityId: unit.id,
          quantity: 1
        },
        issueMaterial
      )
    );
  }
  await sql`SELECT complete_job_to_inventory(
    ${job.jobId}, 2::numeric, NULL, ${f.locationId}, ${f.companyId}, ${USER}
  )`.execute(f.db);
  const received = await f.db
    .selectFrom("itemLedger")
    .select(["trackedEntityId", "quantity"])
    .where("documentType", "=", "Job Receipt")
    .where("documentId", "=", job.jobId)
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", productionItemId)
    .execute();
  expect(received).toHaveLength(2);
  expect(
    received.map((row) => ({
      trackedEntityId: row.trackedEntityId,
      quantity: Number(row.quantity)
    }))
  ).toEqual(
    expect.arrayContaining(
      units.map((unit) => ({
        trackedEntityId: unit.id,
        quantity: 1
      }))
    )
  );
  const cost = await f.db
    .selectFrom("costLedger")
    .select(["cost", "quantity"])
    .where("documentType", "=", "Job Receipt")
    .where("documentId", "=", job.jobId)
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", productionItemId)
    .executeTakeFirstOrThrow();
  expect(Number(cost.cost)).toBe(40);
  expect(Number(cost.quantity)).toBe(2);

  return {
    jobId: job.jobId,
    productionItemId,
    first: units[0]!,
    second: units[1]!
  };
}
