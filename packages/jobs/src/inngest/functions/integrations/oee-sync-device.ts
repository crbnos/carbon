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
  machineTimeRefusal,
  type OeeProvider,
  planMachineTime
} from "@carbon/ee/oee";
import { datetime } from "@carbon/utils";
import { parseAbsolute } from "@internationalized/date";
import { sql } from "kysely";

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
  return value instanceof Date
    ? value.toISOString()
    : parseAbsolute(value, "UTC").toAbsoluteString();
}

const minus = (iso: string, duration: { hours?: number; minutes?: number }) =>
  parseAbsolute(iso, "UTC").subtract(duration).toAbsoluteString();

const compareInstants = (a: string, b: string) =>
  parseAbsolute(a, "UTC").compare(parseAbsolute(b, "UTC"));

/** The later of two ISO instants. */
const later = (a: string, b: string) => (compareInstants(a, b) >= 0 ? a : b);

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

  // `changedAt` of every row this sync stored; a row already stored by an
  // earlier sync conflicts and is not returned.
  const inserted: string[] = [];
  for (let i = 0; i < changes.length; i += INSERT_CHUNK) {
    const rows = await db
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
      .returning("changedAt")
      .execute();
    for (const row of rows) inserted.push(toInstant(row.changedAt));
  }

  // A change stored at or before `appliedThrough` came in late: the engine
  // has already planned past it and never reads it. History is not replanned
  // (it may already be posted), so it is only logged.
  const previouslyApplied = toInstant(device.appliedThrough);
  if (previouslyApplied !== null) {
    const late = inserted.filter(
      (changedAt) => compareInstants(changedAt, previouslyApplied) <= 0
    ).length;
    if (late > 0) {
      console.warn(
        `OEE device ${device.id}: ${late} late state change(s) at or before appliedThrough ${previouslyApplied}, not replanned`
      );
    }
  }

  // The read cursor follows the newest change stored, never the clock: a
  // change the provider stores late with an older timestamp is still inside
  // the next sync's 10-minute overlap. With nothing stored it stays put.
  const lastEventAt = inserted.reduce(later, toInstant(device.lastEventAt));

  await db.transaction().execute(async (trx) => {
    const locked = await lockWorkCenterDevice(trx, {
      workCenterId: device.workCenterId,
      companyId: device.companyId
    });
    // A user removed or remapped the device while the provider was read.
    if (!locked || locked.id !== device.id) return;

    const appliedThrough = toInstant(locked.appliedThrough);
    const currentStateAt = toInstant(locked.currentStateAt);
    const lastManualChangeAt = toInstant(locked.lastManualChangeAt);
    const firstUnplannedPressAt = toInstant(locked.unplannedPressAt);

    const [openEvent, openUnattributed, lastEnd, stored] = await Promise.all([
      trx
        .selectFrom("productionEvent")
        .select(["id", "jobOperationId", "startTime", "createdBy"])
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
      // The latest Machine end in the current run: where steady-state time
      // starts again.
      trx
        .selectFrom("productionEvent")
        .select(sql<Date | null>`max("endTime")`.as("lastEnd"))
        .where("workCenterId", "=", device.workCenterId)
        .where("companyId", "=", device.companyId)
        .where("type", "=", "Machine")
        .where("endTime", ">", currentStateAt ?? mappedAt)
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

    const lastMachineEventEndTime = toInstant(lastEnd?.lastEnd);
    const changeInstants = stored.map((row) => toInstant(row.changedAt));

    // The earliest instant this plan can touch: loads, blocks and recorded
    // time are read from here on.
    const windowFrom = [
      changeInstants[0] ?? null,
      firstUnplannedPressAt,
      lastManualChangeAt,
      currentStateAt === null
        ? mappedAt
        : lastMachineEventEndTime === null
          ? currentStateAt
          : later(currentStateAt, lastMachineEventEndTime),
      openEvent ? toInstant(openEvent.startTime) : null,
      openUnattributed ? toInstant(openUnattributed.startTime) : null
    ]
      .filter((instant): instant is string => instant !== null)
      .reduce((a, b) => (compareInstants(a, b) <= 0 ? a : b), now);

    const [loadRows, blockRows, recordedRows] = await Promise.all([
      // The work center's loads: time goes to the operation loaded when it
      // ran, not the current one.
      trx
        .selectFrom("workCenterLoad")
        .leftJoin("jobOperation", (join) =>
          join
            .onRef("jobOperation.id", "=", "workCenterLoad.jobOperationId")
            .onRef("jobOperation.companyId", "=", "workCenterLoad.companyId")
        )
        .leftJoin("job", (join) =>
          join
            .onRef("job.id", "=", "jobOperation.jobId")
            .onRef("job.companyId", "=", "jobOperation.companyId")
        )
        .select([
          "workCenterLoad.jobOperationId",
          "workCenterLoad.loadedAt",
          "workCenterLoad.unloadedAt",
          "jobOperation.status as operationStatus",
          "job.status as jobStatus"
        ])
        .where("workCenterLoad.workCenterId", "=", device.workCenterId)
        .where("workCenterLoad.companyId", "=", device.companyId)
        .where((eb) =>
          eb.or([
            eb("workCenterLoad.unloadedAt", "is", null),
            eb("workCenterLoad.unloadedAt", ">", windowFrom)
          ])
        )
        .orderBy("workCenterLoad.loadedAt", "asc")
        .execute(),
      // When maintenance blocked the work center. A Down dispatch blocks from
      // the moment it is reported (the MES ends every event on the work
      // center when one is created) until it is Completed or Cancelled; a
      // Planned one blocks from its actual start. Broader than the view
      // "workCentersWithBlockingStatus", which counts In Progress only.
      trx
        .selectFrom("maintenanceDispatch")
        .select([
          sql<
            Date | string
          >`CASE WHEN "oeeImpact" = 'Down' THEN "createdAt" ELSE COALESCE("actualStartTime", "updatedAt", "createdAt") END`.as(
            "blockedFrom"
          ),
          sql<
            Date | string | null
          >`CASE WHEN "status" IN ('Open', 'Assigned', 'In Progress') THEN NULL ELSE COALESCE("completedAt", "actualEndTime", "updatedAt", "createdAt") END`.as(
            "blockedTo"
          )
        ])
        .where("workCenterId", "=", device.workCenterId)
        .where("companyId", "=", device.companyId)
        .where((eb) =>
          eb.or([
            eb.and([
              eb("oeeImpact", "=", "Down"),
              eb("status", "in", ["Open", "Assigned", "In Progress"])
            ]),
            eb.and([
              eb("oeeImpact", "=", "Planned"),
              eb("status", "=", "In Progress")
            ]),
            eb.and([
              eb("oeeImpact", "in", ["Down", "Planned"]),
              eb("status", "in", ["Completed", "Cancelled"]),
              eb.or([
                eb("oeeImpact", "=", "Down"),
                eb("actualStartTime", "is not", null)
              ]),
              eb(
                sql`COALESCE("completedAt", "actualEndTime", "updatedAt", "createdAt")`,
                ">",
                windowFrom
              )
            ])
          ])
        )
        .execute(),
      // Time already recorded on the work center in the window: a late run
      // or the time after a press is recorded less what these hold, and a
      // late stop trims the queue rows among them.
      trx
        .selectFrom("productionEvent")
        .select([
          "id",
          "startTime",
          "endTime",
          sql<"event" | "unattributed">`'event'`.as("kind")
        ])
        .where("workCenterId", "=", device.workCenterId)
        .where("companyId", "=", device.companyId)
        .where("type", "=", "Machine")
        .where((eb) =>
          eb.or([eb("endTime", "is", null), eb("endTime", ">", windowFrom)])
        )
        .unionAll(
          trx
            .selectFrom("unattributedMachineTime")
            .select([
              "id",
              "startTime",
              "endTime",
              sql<"event" | "unattributed">`'unattributed'`.as("kind")
            ])
            .where("workCenterId", "=", device.workCenterId)
            .where("companyId", "=", device.companyId)
            .where((eb) =>
              eb.or([eb("endTime", "is", null), eb("endTime", ">", windowFrom)])
            )
        )
        .execute()
    ]);

    const plan = planMachineTime({
      now,
      minimumStateSeconds,
      mappedAt,
      currentState: locked.currentState,
      currentStateAt,
      lastManualChangeAt,
      firstUnplannedPressAt,
      loads: loadRows.map((row) => ({
        jobOperationId: row.jobOperationId,
        from: toInstant(row.loadedAt),
        to: toInstant(row.unloadedAt),
        assignable:
          row.operationStatus !== null &&
          machineTimeRefusal(row.operationStatus, row.jobStatus) === null
      })),
      blocks: blockRows.map((row) => ({
        from: toInstant(row.blockedFrom),
        to: toInstant(row.blockedTo)
      })),
      openMachineEvent: openEvent
        ? {
            id: openEvent.id,
            jobOperationId: openEvent.jobOperationId,
            startTime: toInstant(openEvent.startTime),
            system: openEvent.createdBy === "system"
          }
        : null,
      openUnattributed: openUnattributed
        ? {
            id: openUnattributed.id,
            startTime: toInstant(openUnattributed.startTime)
          }
        : null,
      lastMachineEventEndTime,
      recordedIntervals: recordedRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        startTime: toInstant(row.startTime),
        endTime: toInstant(row.endTime)
      })),
      changes: stored.map((row, i) => ({
        state: row.state,
        changedAt: changeInstants[i] ?? toInstant(row.changedAt)
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
            .where("endTime", "is", null)
            .execute();
          break;
        case "updateUnattributed":
          await trx
            .updateTable("unattributedMachineTime")
            .set({
              startTime: write.startTime,
              endTime: write.endTime,
              updatedBy: "system",
              updatedAt: now
            })
            .where("id", "=", write.unattributedId)
            .where("companyId", "=", device.companyId)
            .execute();
          break;
        case "deleteUnattributed":
          await trx
            .deleteFrom("unattributedMachineTime")
            .where("id", "=", write.unattributedId)
            .where("companyId", "=", device.companyId)
            .execute();
          break;
      }
    }

    // Unattributed time shorter than the minimum is not kept, whoever closed
    // it: the sync, an operator's press or an unmapping. Like a short state,
    // it is noise in the review queue.
    await trx
      .deleteFrom("unattributedMachineTime")
      .where("workCenterId", "=", device.workCenterId)
      .where("companyId", "=", device.companyId)
      .where("endTime", "is not", null)
      .where(
        sql<boolean>`"endTime" - "startTime" < make_interval(secs => ${minimumStateSeconds})`
      )
      .execute();

    await trx
      .updateTable("workCenterDevice")
      .set({
        currentState: plan.currentState,
        currentStateAt: plan.currentStateAt,
        ...(plan.appliedThrough ? { appliedThrough: plan.appliedThrough } : {}),
        // The cursor also follows changes stored by an earlier attempt whose
        // plan failed: their insert conflicts now and returns nothing.
        lastEventAt: changeInstants.reduce(later, lastEventAt),
        unplannedPressAt: null,
        lastSyncedAt: now,
        lastSyncError: null
      })
      .where("id", "=", device.id)
      .where("companyId", "=", device.companyId)
      .execute();
  });

  return { changes: changes.length };
}
