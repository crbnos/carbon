import { sql, Transaction } from "kysely";
import type { KyselyDatabase as DB } from "../lib/postgres/index.ts";
import { interpolateSerialNumber } from "../lib/utils.ts";

/**
 * Atomically reserve and format the next `count` serial numbers for an item from
 * its configured `itemSerialSequence`. Returns `[]` when the item has no sequence
 * (so callers leave `readableId` null, exactly as before). Runs inside the
 * caller's Kysely transaction, so the counter reservation commits — or rolls back
 * — together with the write that consumes the numbers.
 *
 * Each number interpolates the date/week tokens (%{yyyy} %{yy} %{mm} %{ww} %{dd})
 * plus %{location} (location.code, falling back to the location name).
 *
 * Used by both `assign-serial-numbers` (the N units that exist at job creation)
 * and `issue` (a unit spawned lazily on completion, e.g. after the job quantity
 * was increased), so serials follow the pattern regardless of when the entity is
 * created.
 */
export async function getNextSerialNumbers(
  trx: Transaction<DB>,
  args: {
    itemId: string;
    companyId: string;
    count: number;
    locationCode?: string | null;
    locationName?: string | null;
  }
): Promise<string[]> {
  if (args.count < 1) return [];

  const reserved = await trx
    .updateTable("itemSerialSequence")
    .set({
      next: sql<number>`"next" + ${args.count} * "step"`,
      updatedBy: "system",
      updatedAt: new Date().toISOString(),
    })
    .where("itemId", "=", args.itemId)
    .where("companyId", "=", args.companyId)
    .returning(["next", "prefix", "suffix", "size", "step"])
    .executeTakeFirst();

  if (!reserved) return []; // item has no serial sequence configured

  const size = reserved.size ?? 5;
  const step = reserved.step ?? 1;
  const startNext = reserved.next - args.count * step;
  const context = {
    locationCode: args.locationCode,
    locationName: args.locationName,
  };

  const serials: string[] = [];
  for (let i = 1; i <= args.count; i++) {
    const value = startNext + i * step;
    const counter = value.toString().padStart(size, "0");
    const prefix = interpolateSerialNumber(reserved.prefix, context);
    const suffix = interpolateSerialNumber(reserved.suffix, context);
    serials.push(`${prefix}${counter}${suffix}`);
  }
  return serials;
}
