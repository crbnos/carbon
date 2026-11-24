// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { type Fixture, jobFixture, USER } from "./always-post";

export async function createPairedJob(
  f: Fixture,
  productionItemId: string,
  quantity = 2
) {
  await f.db
    .updateTable("companySettings")
    .set({ serialNumberFromComponent: true })
    .where("id", "=", f.companyId)
    .returning("id")
    .executeTakeFirstOrThrow();
  const salesItemId = `${f.prefix}-sales`;
  await f.db
    .insertInto("item")
    .values({
      id: salesItemId,
      readableId: "PACKED",
      name: "Packed unit",
      type: "Part",
      itemTrackingType: "Serial",
      replenishmentSystem: "Make",
      unitOfMeasureCode: "EA",
      companyId: f.companyId,
      createdBy: USER
    })
    .execute();
  const job = await jobFixture(
    { ...f, assemblyId: salesItemId, partId: productionItemId },
    "pack-out",
    quantity
  );
  await f.db
    .updateTable("jobMaterial")
    .set({
      requiresSerialTracking: true,
      quantity: 1,
      estimatedQuantity: quantity
    })
    .where("id", "=", job.materialId)
    .where("companyId", "=", f.companyId)
    .execute();
  await f.db
    .updateTable("job")
    .set({ status: "Ready" })
    .where("id", "=", job.jobId)
    .where("companyId", "=", f.companyId)
    .execute();
  await f.db
    .updateTable("jobOperation")
    .set({
      status: "Ready",
      operationQuantity: quantity,
      targetQuantity: quantity
    })
    .where("id", "=", job.operationId)
    .where("companyId", "=", f.companyId)
    .execute();
  const output = await f.db
    .selectFrom("trackedEntity")
    .select(["id", "quantity", "readableId"])
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", salesItemId)
    .where(sql<boolean>`attributes->>'Job' = ${job.jobId}`)
    .executeTakeFirstOrThrow();

  await sql`SELECT set_config('app.sync_in_progress','false',false)`.execute(
    f.db
  );
  expect(output).toMatchObject({ quantity, readableId: null });
  return { ...job, salesItemId, productionItemId, unitId: output.id! };
}
