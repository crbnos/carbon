// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * One OEE device's sync: read its state changes from the provider, store them,
 * then — under the device row lock the MES Machine button also takes — let the
 * attribution engine decide the Machine events and unattributed time, and
 * apply its writes. Spec: `.ai/specs/2026-10-12-oee-provider-integration.md`
 * → "The sync job".
 */
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { lockWorkCenterDevice } from "@carbon/database/machine-time";
import {
  type MachineState,
  type OeeProvider,
  planMachineTime
} from "@carbon/ee/oee";
import { datetime } from "@carbon/utils";
import { parseAbsolute } from "@internationalized/date";

const INSERT_CHUNK = 500;

export type OeeSyncDevice = {
  id: string;
  companyId: string;
  workCenterId: string;
  externalDeviceId: string;
  externalSiteId: string | null;
  currentState: MachineState | null;
  currentStateAt: Date | string | null;
  appliedThrough: Date | string | null;
  lastEventAt: Date | string;
  lastManualChangeAt: Date | string | null;
  lastSyncedAt: Date | string | null;
  createdAt: Date | string;
};

/**
 * Kysely hands `timestamptz` over as a JS `Date` while the types say string.
 * Normalize every instant to an ISO string before it is compared or passed on
 * (`.claude/rules/numeric-precision.md` → "Runtime type decoding").
 */
function toInstant(value: Date | string): string;
function toInstant(value: Date | string | null | undefined): string | null;
function toInstant(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

const minus = (iso: string, duration: { hours?: number; minutes?: number }) =>
  parseAbsolute(iso, "UTC").subtract(duration).toAbsoluteString();

export async function syncOeeDevice({
  db,
  provider,
  device,
  minimumStateSeconds
}: {
  db: Kysely<KyselyDatabase>;
  provider: OeeProvider;
  device: OeeSyncDevice;
  minimumStateSeconds: number;
}) {
  const now = datetime.timestamp();
  const mappedAt = toInstant(device.createdAt);
  const firstLook = minus(mappedAt, { hours: 24 });

  // The first sync looks back a day to learn the state at the mapping; later
  // syncs re-read 10 minutes so an event the provider stored late is caught.
  const since =
    device.lastSyncedAt === null
      ? firstLook
      : minus(toInstant(device.lastEventAt), { minutes: 10 });

  const changes = await provider.listStateChanges(
    {
      externalDeviceId: device.externalDeviceId,
      externalSiteId: device.externalSiteId
    },
    { since, until: now }
  );

  for (let i = 0; i < changes.length; i += INSERT_CHUNK) {
    await db
      .insertInto("machineStateChange")
      .values(
        changes.slice(i, i + INSERT_CHUNK).map((change) => ({
          companyId: device.companyId,
          workCenterDeviceId: device.id,
          workCenterId: device.workCenterId,
          externalEventId: change.externalEventId,
          state: change.state,
          changedAt: change.changedAt
        }))
      )
      .onConflict((oc) =>
        oc
          .columns(["workCenterDeviceId", "externalEventId", "companyId"])
          .doNothing()
      )
      .execute();
  }

  await db.transaction().execute(async (trx) => {
    const locked = await lockWorkCenterDevice(trx, {
      workCenterId: device.workCenterId,
      companyId: device.companyId
    });
    // A user removed or remapped the device while the provider was read.
    if (!locked || locked.id !== device.id) return;

    const appliedThrough = toInstant(locked.appliedThrough);

    const [workCenter, blocking, openEvent, openUnattributed, lastEnd, stored] =
      await Promise.all([
        trx
          .selectFrom("workCenter")
          .select(["loadedJobOperationId", "loadedAt"])
          .where("id", "=", device.workCenterId)
          .where("companyId", "=", device.companyId)
          .executeTakeFirst(),
        // The predicate of the view "workCentersWithBlockingStatus".
        trx
          .selectFrom("maintenanceDispatch")
          .select("id")
          .where("workCenterId", "=", device.workCenterId)
          .where("companyId", "=", device.companyId)
          .where("status", "=", "In Progress")
          .where("oeeImpact", "in", ["Down", "Planned"])
          .executeTakeFirst(),
        trx
          .selectFrom("productionEvent")
          .select(["id", "startTime"])
          .where("workCenterId", "=", device.workCenterId)
          .where("companyId", "=", device.companyId)
          .where("type", "=", "Machine")
          .where("endTime", "is", null)
          .orderBy("startTime", "desc")
          .executeTakeFirst(),
        trx
          .selectFrom("unattributedMachineTime")
          .select(["id", "startTime"])
          .where("workCenterId", "=", device.workCenterId)
          .where("companyId", "=", device.companyId)
          .where("endTime", "is", null)
          .orderBy("startTime", "desc")
          .executeTakeFirst(),
        trx
          .selectFrom("productionEvent")
          .select((eb) => eb.fn.max("endTime").as("lastEnd"))
          .where("workCenterId", "=", device.workCenterId)
          .where("companyId", "=", device.companyId)
          .where("type", "=", "Machine")
          .executeTakeFirst(),
        trx
          .selectFrom("machineStateChange")
          .select(["state", "changedAt"])
          .where("workCenterDeviceId", "=", device.id)
          .where("companyId", "=", device.companyId)
          .where("changedAt", ">", appliedThrough ?? firstLook)
          .orderBy("changedAt", "asc")
          .execute()
      ]);

    const plan = planMachineTime({
      now,
      minimumStateSeconds,
      mappedAt,
      currentState: locked.currentState,
      currentStateAt: toInstant(locked.currentStateAt),
      lastManualChangeAt: toInstant(locked.lastManualChangeAt),
      loadedJobOperationId: workCenter?.loadedJobOperationId ?? null,
      loadedAt: toInstant(workCenter?.loadedAt),
      isBlocked: blocking !== undefined,
      openMachineEvent: openEvent
        ? { id: openEvent.id, startTime: toInstant(openEvent.startTime) }
        : null,
      openUnattributed: openUnattributed
        ? {
            id: openUnattributed.id,
            startTime: toInstant(openUnattributed.startTime)
          }
        : null,
      lastMachineEventEndTime: toInstant(
        lastEnd?.lastEnd as Date | string | null | undefined
      ),
      changes: stored.map((row) => ({
        state: row.state,
        changedAt: toInstant(row.changedAt)
      }))
    });

    for (const write of plan.writes) {
      switch (write.kind) {
        case "insertMachineEvent":
          await trx
            .insertInto("productionEvent")
            .values({
              type: "Machine",
              jobOperationId: write.jobOperationId,
              workCenterId: device.workCenterId,
              startTime: write.startTime,
              endTime: write.endTime,
              employeeId: null,
              companyId: device.companyId,
              createdBy: "system"
            })
            .execute();
          break;
        case "closeMachineEvent":
          await trx
            .updateTable("productionEvent")
            .set({
              endTime: write.endTime,
              updatedBy: "system",
              updatedAt: now
            })
            .where("id", "=", write.productionEventId)
            .where("companyId", "=", device.companyId)
            .where("endTime", "is", null)
            .execute();
          break;
        case "insertUnattributed":
          await trx
            .insertInto("unattributedMachineTime")
            .values({
              companyId: device.companyId,
              workCenterId: device.workCenterId,
              startTime: write.startTime,
              endTime: write.endTime,
              createdBy: "system"
            })
            .execute();
          break;
        case "closeUnattributed":
          await trx
            .updateTable("unattributedMachineTime")
            .set({
              endTime: write.endTime,
              updatedBy: "system",
              updatedAt: now
            })
            .where("id", "=", write.unattributedId)
            .where("companyId", "=", device.companyId)
            .execute();
          break;
      }
    }

    await trx
      .updateTable("workCenterDevice")
      .set({
        currentState: plan.currentState,
        currentStateAt: plan.currentStateAt,
        ...(plan.appliedThrough ? { appliedThrough: plan.appliedThrough } : {}),
        lastEventAt: now,
        lastSyncedAt: now,
        lastSyncError: null
      })
      .where("id", "=", device.id)
      .where("companyId", "=", device.companyId)
      .execute();
  });

  return { changes: changes.length };
}
