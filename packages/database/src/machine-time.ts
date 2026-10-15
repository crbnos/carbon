// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import type { KyselyTx } from "./client";

export async function lockWorkCenterDevice(
  trx: KyselyTx,
  args: { workCenterId: string; companyId: string }
) {
  return trx
    .selectFrom("workCenterDevice")
    .selectAll()
    .where("workCenterId", "=", args.workCenterId)
    .where("companyId", "=", args.companyId)
    .forUpdate()
    .executeTakeFirst();
}

type CloseArgs = {
  workCenterId: string;
  companyId: string;
  userId: string;
  at: string;
};

/**
 * End the work center's open unattributed time at `at`. A row that starts
 * after `at` stays open for the sync to close.
 */
async function endOpenUnattributedTime(trx: KyselyTx, args: CloseArgs) {
  await trx
    .updateTable("unattributedMachineTime")
    .set({ endTime: args.at, updatedBy: args.userId, updatedAt: args.at })
    .where("workCenterId", "=", args.workCenterId)
    .where("companyId", "=", args.companyId)
    .where("endTime", "is", null)
    .where("startTime", "<=", args.at)
    .execute();
}

/**
 * A device leaves a work center (unmapped or remapped). End the time its
 * sensor opened there — Machine events created by `system` and running
 * unattributed time — because no later sync of that device will close it. An operator's
 * own Machine event stays open. Call it under `lockWorkCenterDevice`.
 * Returns the ended event ids: the caller posts them once its transaction
 * commits.
 */
export async function endSensorMachineTime(
  trx: KyselyTx,
  args: CloseArgs
): Promise<{ endedEventIds: string[] }> {
  const ended = await trx
    .updateTable("productionEvent")
    .set({ endTime: args.at, updatedBy: args.userId, updatedAt: args.at })
    .where("workCenterId", "=", args.workCenterId)
    .where("companyId", "=", args.companyId)
    .where("type", "=", "Machine")
    .where("createdBy", "=", "system")
    .where("endTime", "is", null)
    .where("startTime", "<=", args.at)
    .returning("id")
    .execute();
  await endOpenUnattributedTime(trx, args);
  return { endedEventIds: ended.map((row) => row.id) };
}

/**
 * The locks a Machine press holds, in the one order every writer takes them:
 * the device row first (the sync locks it, then ends events), then a lock on
 * the work center itself, which exists with or without a device. Anything
 * that ends a Machine event under a press takes these before any event row.
 * Returns the device, if the work center has one.
 */
export async function lockMachinePress(
  trx: KyselyTx,
  args: { workCenterId: string; companyId: string }
) {
  const device = await lockWorkCenterDevice(trx, args);
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`machinePress:${args.workCenterId}`}, 0))`.execute(
    trx
  );
  return device;
}

/** The time now, read inside the transaction (an absolute instant). */
async function lockedNow(trx: KyselyTx) {
  const { rows } = await sql<{
    now: Date;
  }>`SELECT clock_timestamp() AS now`.execute(trx);
  const now = rows[0]?.now;
  if (!now) throw new Error("Could not read the time");
  return now.toISOString();
}

/**
 * A machine has one machine time. An operator pressed Machine Start or Pause
 * on a work center: separate operators share a single machine time, so on
 * any work center, with or without a device, the press ends every open
 * Machine event there at the press time — from any operator or the sensor.
 * An event that starts after the press stays open. A Start then opens the
 * new one in the same transaction.
 *
 * On a work center with a device, the press also ends the open unattributed
 * time at the press time and records the press, so an older sensor change
 * never undoes it. Without the unattributed close, a Start on a running
 * machine with no loaded operation counted the same minutes twice: once on
 * the operator's event and once in the supervisor queue.
 *
 * Presses on one work center run one at a time, and the press time is read
 * under the locks (unless the caller fixes it), so two presses never leave
 * two Machine events open and the recorded press never moves backwards.
 */
export async function recordManualMachinePress(
  trx: KyselyTx,
  args: {
    workCenterId: string;
    companyId: string;
    userId: string;
    pressedAt?: string;
  }
): Promise<{ mapped: boolean; endedEventIds: string[]; pressedAt: string }> {
  const device = await lockMachinePress(trx, args);
  const pressedAt = args.pressedAt ?? (await lockedNow(trx));

  const ended = await trx
    .updateTable("productionEvent")
    .set({
      endTime: pressedAt,
      updatedBy: args.userId,
      updatedAt: pressedAt
    })
    .where("workCenterId", "=", args.workCenterId)
    .where("companyId", "=", args.companyId)
    .where("type", "=", "Machine")
    .where("endTime", "is", null)
    .where("startTime", "<=", pressedAt)
    .returning("id")
    .execute();
  const endedEventIds = ended.map((row) => row.id);

  if (!device) return { mapped: false, endedEventIds, pressedAt };

  await endOpenUnattributedTime(trx, {
    workCenterId: args.workCenterId,
    companyId: args.companyId,
    userId: args.userId,
    at: pressedAt
  });

  // The latest press never moves backwards, and the earliest one since the
  // last sync is kept for the sync to plan from.
  await trx
    .updateTable("workCenterDevice")
    .set({
      lastManualChangeAt: sql`GREATEST(COALESCE("lastManualChangeAt", ${pressedAt}::timestamptz), ${pressedAt}::timestamptz)`,
      unplannedPressAt: sql`LEAST(COALESCE("unplannedPressAt", ${pressedAt}::timestamptz), ${pressedAt}::timestamptz)`,
      updatedBy: args.userId,
      updatedAt: pressedAt
    })
    .where("id", "=", device.id)
    .where("companyId", "=", args.companyId)
    .execute();

  return { mapped: true, endedEventIds, pressedAt };
}
