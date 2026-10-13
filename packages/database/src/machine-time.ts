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

/**
 * An operator pressed Machine Start or Stop on a work center. If the work
 * center has a device, end its open Machine events at the press time and
 * record the press, so an older sensor change never undoes it.
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
  const device = await lockWorkCenterDevice(trx, args);
  if (!device) return { mapped: false, endedEventIds: [] };

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
    .returning("id")
    .execute();

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

  return { mapped: true, endedEventIds: ended.map((row) => row.id) };
}
