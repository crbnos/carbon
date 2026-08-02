import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { sql } from "kysely";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { requirePermissions } from "../lib/supabase.ts";
import { interpolateSerialNumber } from "../lib/utils.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  jobId: z.string(),
  companyId: z.string(),
  userId: z.string(),
});

/**
 * Assigns configured serial numbers to a job's tracked entities at creation time.
 *
 * Invoked (best-effort) from `insertJob` only when the job's item has an
 * `itemSerialSequence`. For a Batch item it stamps one number on the single
 * whole-quantity seed entity; for a Serial item it splits the seed into N
 * quantity-1 entities and stamps one number on each. Numbers come from the
 * item's sequence (atomic counter) with %{...} date/week/location tokens.
 *
 * Idempotent: it no-ops when the seed is already numbered or already split.
 */
serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const payload = await req.json();
    const { jobId, companyId, userId } = payloadValidator.parse(payload);

    // Auth gate (throws on denial). Service-role invocations from insertJob pass.
    await requirePermissions(req, companyId, userId, { update: "production" });

    const result = await db.transaction().execute(async (trx) => {
      // 1. The job
      const job = await trx
        .selectFrom("job")
        .select(["id", "itemId", "quantity", "locationId"])
        .where("id", "=", jobId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!job) throw new Error(`Job ${jobId} not found`);

      // 2. Only serial/batch tracked items carry serial numbers
      const item = await trx
        .selectFrom("item")
        .select(["itemTrackingType"])
        .where("id", "=", job.itemId)
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
          .executeTakeFirst();
        locationCode = location?.code ?? null;
        locationName = location?.name ?? null;
      }

      // 5. The root make-method seed entity for this job. The job-insert
      //    interceptor tags it with the Job id; sub-assembly seeds also carry a
      //    Job Material id, and consumption remainders carry a Split Entity ID —
      //    exclude both so we only touch the root make method's seed.
      const seeds = await trx
        .selectFrom("trackedEntity")
        .selectAll()
        .where("companyId", "=", companyId)
        .where(sql<boolean>`attributes->>'Job' = ${jobId}`)
        .where(sql<boolean>`attributes->>'Job Material' IS NULL`)
        .where(sql<boolean>`attributes->>'Split Entity ID' IS NULL`)
        .orderBy("createdAt", "asc")
        .execute();

      // Idempotency: already split into many, or already numbered → do nothing.
      if (seeds.length !== 1) return { assigned: 0 };
      const seed = seeds[0];
      if (seed.readableId) return { assigned: 0 };

      // 6. How many numbers to reserve. Serial → one per unit; Batch → one.
      const count =
        trackingType === "Batch" ? 1 : Math.round(Number(job.quantity));
      if (count < 1) return { assigned: 0 };

      // 7. Atomically reserve the next `count` values (row-locking UPDATE).
      const reserved = await trx
        .updateTable("itemSerialSequence")
        .set({
          next: sql<number>`"next" + ${count} * "step"`,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
        })
        .where("itemId", "=", job.itemId)
        .where("companyId", "=", companyId)
        .returning(["next", "prefix", "suffix", "size", "step"])
        .executeTakeFirstOrThrow();

      const size = reserved.size ?? 5;
      const step = reserved.step ?? 1;
      const startNext = reserved.next - count * step;
      const context = { locationCode, locationName };
      const serials: string[] = [];
      for (let i = 1; i <= count; i++) {
        const value = startNext + i * step;
        const counter = value.toString().padStart(size, "0");
        const prefix = interpolateSerialNumber(reserved.prefix, context);
        const suffix = interpolateSerialNumber(reserved.suffix, context);
        serials.push(`${prefix}${counter}${suffix}`);
      }

      // 8. Assign. Batch keeps the single whole-quantity seed; Serial splits it
      //    into `count` quantity-1 entities, one number each (seed becomes #1).
      if (trackingType === "Batch") {
        await trx
          .updateTable("trackedEntity")
          .set({ readableId: serials[0] })
          .where("id", "=", seed.id)
          .execute();
      } else {
        await trx
          .updateTable("trackedEntity")
          .set({ readableId: serials[0], quantity: 1 })
          .where("id", "=", seed.id)
          .execute();

        if (count > 1) {
          const rows = serials.slice(1).map((readableId) => ({
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
            createdBy: seed.createdBy,
          }));
          await trx.insertInto("trackedEntity").values(rows).execute();
        }
      }

      return { assigned: count };
    });

    return jsonResponse({ success: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
});
