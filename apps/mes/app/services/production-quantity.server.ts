// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import type { z } from "zod";
import type { nonScrapQuantityValidator } from "./models";

/**
 * Records one completion only while the operation's completed quantity is
 * still `expectedQuantityComplete`, read under the operation's row lock, so
 * two requests for one unit record it once. Kysely bypasses RLS: the caller
 * checks `create: production` (the productionQuantity insert policy) first.
 */
export async function insertProductionQuantityIfCurrent(
  db: Kysely<KyselyDatabase>,
  data: z.infer<typeof nonScrapQuantityValidator> & {
    companyId: string;
    createdBy: string;
  },
  expectedQuantityComplete: number
): Promise<{ id: string } | null> {
  const inserted = await db.transaction().execute(async (trx) => {
    // Terminal quantities can finish and receive the job from their insert
    // trigger. Take the receipt's job lock (FOR UPDATE) ahead of the checked
    // operation, as Finish does, so the receipt never upgrades a weaker one.
    const job = await trx
      .selectFrom("job")
      .innerJoin("jobOperation", "jobOperation.jobId", "job.id")
      .select("job.id")
      .where("jobOperation.id", "=", data.jobOperationId)
      .where("jobOperation.companyId", "=", data.companyId)
      .where("job.companyId", "=", data.companyId)
      .forUpdate("job")
      .executeTakeFirst();
    if (!job) return null;
    const operation = await trx
      .selectFrom("jobOperation")
      .select("quantityComplete")
      .where("id", "=", data.jobOperationId)
      .where("jobId", "=", job.id)
      .where("companyId", "=", data.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (
      !operation ||
      Number(operation.quantityComplete ?? 0) !== expectedQuantityComplete
    ) {
      return null;
    }
    return trx
      .insertInto("productionQuantity")
      .values({
        jobOperationId: data.jobOperationId,
        type: "Production",
        quantity: data.quantity,
        notes: data.notes ?? null,
        setupProductionEventId: data.setupProductionEventId ?? null,
        laborProductionEventId: data.laborProductionEventId ?? null,
        machineProductionEventId: data.machineProductionEventId ?? null,
        companyId: data.companyId,
        createdBy: data.createdBy
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  });

  if (inserted) {
    trackWorkEvent("production_quantity_reported", {
      companyId: data.companyId,
      userId: data.createdBy,
      productionQuantityId: inserted.id,
      jobOperationId: data.jobOperationId,
      quantity: data.quantity,
      source: "mes"
    });
  }
  return inserted;
}
