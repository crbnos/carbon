// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
 */
export async function endSensorMachineTime(trx: KyselyTx, args: CloseArgs) {
  await trx
    .updateTable("productionEvent")
    .set({ endTime: args.at, updatedBy: args.userId, updatedAt: args.at })
    .where("workCenterId", "=", args.workCenterId)
    .where("companyId", "=", args.companyId)
    .where("type", "=", "Machine")
    .where("createdBy", "=", "system")
    .where("endTime", "is", null)
    .where("startTime", "<=", args.at)
    .execute();
  await endOpenUnattributedTime(trx, args);
}

/**
 * A machine has one machine time. An operator pressed Machine Start or Pause
 * on a work center: separate operators share a single machine time, so on
 * any work center, with or without a device, the press ends every open
 * Machine event there at the press time — from any operator or the sensor.
 * An event that starts after the press stays open. A Start then opens the
 * new one.
 *
 * On a work center with a device, the press also ends the open unattributed
 * time at the press time and records the press, so an older sensor change
 * never undoes it. Without the unattributed close, a Start on a running
 * machine with no loaded operation counted the same minutes twice: once on
 * the operator's event and once in the supervisor queue.
 */
export async function recordManualMachinePress(
  trx: KyselyTx,
  args: {
    workCenterId: string;
    companyId: string;
    userId: string;
    pressedAt: string;
  }
): Promise<{ mapped: boolean; endedEventIds: string[] }> {
  // The device lock comes first, as in the sync and the mapping writes: the
  // sync locks the device and then ends events, so ending events first and
  // then waiting for the device could deadlock with it.
  const device = await lockWorkCenterDevice(trx, args);

  const ended = await trx
    .updateTable("productionEvent")
    .set({
      endTime: args.pressedAt,
      updatedBy: args.userId,
      updatedAt: args.pressedAt
    })
    .where("workCenterId", "=", args.workCenterId)
    .where("companyId", "=", args.companyId)
    .where("type", "=", "Machine")
    .where("endTime", "is", null)
    .where("startTime", "<=", args.pressedAt)
    .returning("id")
    .execute();
  const endedEventIds = ended.map((row) => row.id);

  if (!device) return { mapped: false, endedEventIds };

  await endOpenUnattributedTime(trx, {
    workCenterId: args.workCenterId,
    companyId: args.companyId,
    userId: args.userId,
    at: args.pressedAt
  });

  await trx
    .updateTable("workCenterDevice")
    .set({
      lastManualChangeAt: args.pressedAt,
      updatedBy: args.userId,
      updatedAt: args.pressedAt
    })
    .where("id", "=", device.id)
    .where("companyId", "=", args.companyId)
    .execute();

  return { mapped: true, endedEventIds };
}
