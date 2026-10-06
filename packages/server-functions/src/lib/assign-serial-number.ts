// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase as DB } from "@carbon/database/client";
import { getNextSerialNumbers } from "@carbon/database/sequence";
import type { Transaction } from "kysely";

/**
 * Number ONE tracked entity from its item's `itemSerialSequence`, if it has no
 * number yet. Returns the assigned serial, or null when nothing was assigned —
 * the entity is already numbered, has no item, or its item has no sequence.
 *
 * This is the `serialNumberTiming = 'production'` path: the job's entities are
 * created unnumbered and a unit draws its number the first time it is actually
 * touched (first production event, first operation completion, or scrap). Every
 * call site is therefore a "first touch" hook, and all of them must be safe to
 * fire repeatedly on the same unit — hence the `readableId IS NULL` guard plus
 * the row lock below.
 *
 * The lock is what makes concurrency safe: two operators tapping the same unit
 * at once serialize on the entity row, and the loser sees the winner's
 * readableId and no-ops instead of reserving a second number and burning it.
 * Runs inside the caller's transaction, so the counter reservation commits — or
 * rolls back — with the write that prompted it.
 */
export async function assignSerialNumberIfMissing(
  trx: Transaction<DB>,
  args: { trackedEntityId: string; companyId: string }
): Promise<string | null> {
  const entity = await trx
    .selectFrom("trackedEntity")
    .select(["id", "itemId", "readableId", "attributes"])
    .where("id", "=", args.trackedEntityId)
    .where("companyId", "=", args.companyId)
    .forUpdate()
    .executeTakeFirst();

  if (!entity || entity.readableId || !entity.itemId) return null;

  // Location context for the %{location} token, resolved through the job the
  // entity was seeded for. A unit with no Job attribute (a receipt entity, say)
  // simply interpolates the token to nothing, exactly as it would at job
  // creation when the job has no location.
  let locationCode: string | null = null;
  let locationName: string | null = null;
  const jobId = (entity.attributes as Record<string, unknown> | null)?.Job;
  if (typeof jobId === "string") {
    const location = await trx
      .selectFrom("job")
      .innerJoin("location", "location.id", "job.locationId")
      .select(["location.code as code", "location.name as name"])
      .where("job.id", "=", jobId)
      .where("job.companyId", "=", args.companyId)
      .executeTakeFirst();
    locationCode = location?.code ?? null;
    locationName = location?.name ?? null;
  }

  const serials = await getNextSerialNumbers(trx, {
    itemId: entity.itemId,
    companyId: args.companyId,
    count: 1,
    locationCode,
    locationName
  });
  const readableId = serials[0];
  if (!readableId) return null;

  await trx
    .updateTable("trackedEntity")
    .set({ readableId })
    .where("id", "=", entity.id)
    .where("companyId", "=", args.companyId)
    .execute();

  return readableId;
}
