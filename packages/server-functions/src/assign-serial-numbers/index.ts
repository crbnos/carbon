// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getNextSerialNumbers } from "@carbon/database/sequence";
import { sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";
import { attributesContain } from "../tracked-entity-attributes";

export const assignSerialNumbersInput = z.object({
  jobId: z.string()
});

/**
 * Assigns configured serial numbers to a job's tracked entities at creation time.
 *
 * Run (best-effort) by `insertJob` only when the job's item has an
 * `itemSerialSequence`. For a Batch item it stamps one number on the single
 * whole-quantity seed entity; for a Serial item it splits the seed into N
 * quantity-1 entities and stamps one number on each. Numbers come from the
 * item's sequence (atomic counter) with %{...} date/week/location tokens.
 *
 * Idempotent: it no-ops when the seed is already numbered or already split.
 */
const assignSerialNumbers = defineServerFn({
  name: "assign-serial-numbers",
  input: assignSerialNumbersInput,
  permissions: { update: "production" },
  async run(ctx, { jobId }) {
    const { db, companyId } = ctx;

    return db.transaction().execute(async (trx) => {
      // 1. The job
      const job = await trx
        .selectFrom("job")
        .select(["id", "itemId", "quantity", "locationId"])
        .where("id", "=", jobId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!job) throw new NotFoundError(`Job ${jobId} not found`);

      // 2. Only serial/batch tracked items carry serial numbers
      const item = await trx
        .selectFrom("item")
        .select(["itemTrackingType"])
        .where("id", "=", job.itemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      const trackingType = item?.itemTrackingType;
      if (trackingType !== "Serial" && trackingType !== "Batch") {
        return { assigned: 0 };
      }

      // 3. The item's serial sequence (optional, at most one)
      const sequence = await trx
        .selectFrom("itemSerialSequence")
        .select(["prefix", "suffix", "next", "size", "step"])
        .where("itemId", "=", job.itemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!sequence) return { assigned: 0 };

      // 4. Location context for the %{location} token (code, falling back to name)
      let locationCode: string | null = null;
      let locationName: string | null = null;
      if (job.locationId) {
        const location = await trx
          .selectFrom("location")
          .select(["code", "name"])
          .where("id", "=", job.locationId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        locationCode = location?.code ?? null;
        locationName = location?.name ?? null;
      }

      // 5. The root make-method seed entity for this job. The job-insert
      //    interceptor tags it with the Job id; sub-assembly seeds also carry a
      //    Job Material id, and split fragments carry a pointer key — the
      //    legacy "Split Entity ID" (old convention: departed original) or
      //    "Split From Entity ID" (new convention: split child). Exclude all
      //    so we only touch the root make method's seed.
      const seeds = await trx
        .selectFrom("trackedEntity")
        .selectAll()
        .where("companyId", "=", companyId)
        .where(attributesContain({ Job: jobId }))
        .where(sql<boolean>`attributes->>'Job Material' IS NULL`)
        .where(sql<boolean>`attributes->>'Split Entity ID' IS NULL`)
        .where(sql<boolean>`attributes->>'Split From Entity ID' IS NULL`)
        .orderBy("createdAt", "asc")
        // Lock the seed row for the duration of the transaction so concurrent
        // runs for the same job serialize here: the second waits, then sees
        // the readableId the first assigned and no-ops the idempotency guard
        // below instead of reserving a duplicate range and inserting duplicates.
        .forUpdate()
        .execute();

      // Idempotency: already split into many, or already numbered → do nothing.
      const seed = seeds[0];
      if (seeds.length !== 1 || !seed) return { assigned: 0 };
      if (seed.readableId) return { assigned: 0 };

      // 6. How many numbers to reserve. Serial → one per unit; Batch → one.
      const count =
        trackingType === "Batch" ? 1 : Math.round(Number(job.quantity));
      if (count < 1) return { assigned: 0 };

      // 7. Atomically reserve + format the next `count` serial numbers.
      const serials = await getNextSerialNumbers(trx, {
        itemId: job.itemId,
        companyId,
        count,
        locationCode,
        locationName
      });
      if (serials.length === 0) return { assigned: 0 };

      // 8. Assign. Batch keeps the single whole-quantity seed; Serial splits it
      //    into `count` quantity-1 entities, one number each (seed becomes #1).
      if (trackingType === "Batch") {
        await trx
          .updateTable("trackedEntity")
          .set({ readableId: serials[0] })
          .where("id", "=", seed.id)
          .where("companyId", "=", companyId)
          .execute();
      } else {
        await trx
          .updateTable("trackedEntity")
          .set({ readableId: serials[0], quantity: 1 })
          .where("id", "=", seed.id)
          .where("companyId", "=", companyId)
          .execute();

        if (count > 1) {
          // Each row gets its OWN `createdAt`, one millisecond apart, in serial
          // order. Left to the column default they would all take the
          // transaction's `now()` and tie — and `createdAt` is the unit axis
          // every step record is indexed against (see
          // getTrackedEntitiesByMakeMethodId). Tied rows come back in physical
          // order, which an UPDATE changes, so recorded values slid onto other
          // serials. The seed keeps its earlier timestamp and stays unit 0.
          const rows = serials.slice(1).map((readableId, offset) => ({
            createdAt: sql<string>`now() + ${offset + 1}::int * interval '1 millisecond'`,
            sourceDocument: seed.sourceDocument,
            sourceDocumentId: seed.sourceDocumentId,
            sourceDocumentReadableId: seed.sourceDocumentReadableId,
            quantity: 1,
            status: seed.status,
            attributes: seed.attributes,
            itemId: seed.itemId ?? null,
            expirationDate: seed.expirationDate ?? null,
            readableId,
            companyId,
            createdBy: seed.createdBy
          }));
          await trx.insertInto("trackedEntity").values(rows).execute();
        }
      }

      return { assigned: count };
    });
  }
});

export default assignSerialNumbers;
