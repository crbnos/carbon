// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The shop-floor timer's row writes: a production event started or ended, a
// Machine press, and the PostgREST-shaped responses they return. The checks
// that come before them are `startOperationTimer` (`./timer`).

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { toJson } from "@carbon/database/json";
import {
  lockMachinePress,
  recordManualMachinePress
} from "@carbon/database/machine-time";
import { getLogger } from "@carbon/logger";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { WorkSource } from "../telemetry/capture";
import { trackWorkEvent } from "../telemetry/capture";

const log = getLogger("lib", "production-timer");

type Client = SupabaseClient<Database>;

export type ProductionEventType =
  Database["public"]["Enums"]["productionEventType"];

/**
 * A `{ data, error }` failure shaped like a PostgREST response, for when a
 * caller-supplied record id does not belong to the caller's company. Callers
 * of these services pass service-role clients, so the companyId check is the
 * only tenant boundary — a miss must stop the write, not no-op past it.
 */
export function notFoundResponse(message: string) {
  return {
    data: null,
    error: {
      name: "PostgrestError",
      message,
      details: "",
      hint: "",
      code: "PGRST116"
    } as PostgrestError,
    count: null,
    status: 404,
    statusText: "Not Found"
  };
}

const UNIQUE_VIOLATION = "23505";

function conflictResponse(message: string) {
  return {
    data: null,
    error: {
      name: "PostgrestError",
      message,
      details: "",
      hint: "",
      code: "PGRST409"
    } as PostgrestError,
    count: null,
    status: 409,
    statusText: "Conflict"
  };
}

/** Whether a production event already records this serial (its tracked activity output). */
async function timerRecordsEntity(
  client: Client,
  productionEventId: string,
  trackedEntityId: string,
  companyId: string
) {
  const activities = await client
    .from("trackedActivity")
    .select("id")
    .eq("sourceDocument", "Production Event")
    .eq("sourceDocumentId", productionEventId)
    .eq("companyId", companyId);
  const activityIds = activities.data?.map((activity) => activity.id) ?? [];
  if (activityIds.length === 0) return false;
  const output = await client
    .from("trackedActivityOutput")
    .select("trackedActivityId")
    .in("trackedActivityId", activityIds)
    .eq("trackedEntityId", trackedEntityId)
    .eq("companyId", companyId)
    .limit(1);
  return (output.data?.length ?? 0) > 0;
}

export async function endProductionEvent(
  client: Client,
  data: {
    id: string;
    endTime: string;
    employeeId: string;
    companyId: string;
  }
) {
  // Only an open event ends: a repeated End must not move its end time.
  return client
    .from("productionEvent")
    .update({ endTime: data.endTime, updatedBy: data.employeeId })
    .eq("id", data.id)
    .eq("companyId", data.companyId)
    .is("endTime", null)
    .select("*");
}

/** A Machine press refused to end an event (already ended, or started later). */
class MachineEventNotEnded extends Error {}

/**
 * Ends an operator's open Machine event with a press: the press ends every
 * open Machine event on the work center, this one included, in one
 * transaction. Null when the event is no longer open, or the press could not
 * end it (it starts after the press), and then nothing was ended. Skips RLS:
 * the caller checks that the user may update production events first.
 */
export async function endMachineProductionEvent(
  db: Kysely<KyselyDatabase>,
  args: { id: string; workCenterId: string; companyId: string; userId: string }
) {
  try {
    return await db.transaction().execute(async (trx) => {
      await lockMachinePress(trx, args);
      const open = await trx
        .selectFrom("productionEvent")
        .select("id")
        .where("id", "=", args.id)
        .where("companyId", "=", args.companyId)
        .where("endTime", "is", null)
        .forUpdate()
        .executeTakeFirst();
      if (!open) throw new MachineEventNotEnded();
      const press = await recordManualMachinePress(trx, args);
      if (!press.endedEventIds.includes(args.id)) {
        throw new MachineEventNotEnded();
      }
      return press;
    });
  } catch (error) {
    if (error instanceof MachineEventNotEnded) return null;
    throw error;
  }
}

// A start flips a not-yet-started job and operation to "In Progress", so the
// floor need not mark it by hand. The status guards make a re-start a no-op.
// Best-effort: a failure here must not undo the event that already started.
async function autoStartJobAndOperation(
  client: Client,
  args: { jobOperationId: string; userId: string; companyId: string }
) {
  const op = await client
    .from("jobOperation")
    .select("jobId, status")
    .eq("id", args.jobOperationId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (op.error || !op.data) return;

  const updates: PromiseLike<unknown>[] = [];
  if (["Todo", "Ready", "Waiting"].includes(op.data.status ?? "")) {
    updates.push(
      client
        .from("jobOperation")
        .update({ status: "In Progress", updatedBy: args.userId })
        .eq("id", args.jobOperationId)
        .eq("companyId", args.companyId)
        .in("status", ["Todo", "Ready", "Waiting"])
    );
  }
  if (op.data.jobId) {
    updates.push(
      client
        .from("job")
        .update({ status: "In Progress", updatedBy: args.userId })
        .eq("id", op.data.jobId)
        .eq("companyId", args.companyId)
        .in("status", ["Draft", "Planned", "Ready"])
    );
  }
  await Promise.all(updates);
}

/**
 * Every record id a production event references must belong to the event's
 * company. `startProductionEvent` is called with a service-role client (the
 * QR start route) as well as the user client, and a foreign id here would
 * attach another tenant's operation, work center, batch or serial to this
 * company's timer and genealogy. One scoped query per id type.
 */
async function verifyProductionEventRefs(
  client: Client,
  args: {
    companyId: string;
    jobOperationId: string;
    workCenterId?: string;
    jobOperationBatchId?: string;
    trackedEntityId?: string;
  }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { companyId } = args;
  const [operation, workCenter, batch, entity] = await Promise.all([
    client
      .from("jobOperation")
      .select("id")
      .eq("id", args.jobOperationId)
      .eq("companyId", companyId)
      .maybeSingle(),
    args.workCenterId
      ? client
          .from("workCenter")
          .select("id")
          .eq("id", args.workCenterId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null,
    args.jobOperationBatchId
      ? client
          .from("jobOperationBatch")
          .select("id")
          .eq("id", args.jobOperationBatchId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null,
    args.trackedEntityId
      ? client
          .from("trackedEntity")
          .select("id")
          .eq("id", args.trackedEntityId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null
  ]);

  const missing = [
    !operation.data && "Job operation",
    workCenter && !workCenter.data && "Work center",
    batch && !batch.data && "Operation batch",
    entity && !entity.data && "Tracked entity"
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    log.warning(
      "startProductionEvent: referenced record not found in company",
      {
        companyId,
        missing,
        jobOperationId: args.jobOperationId,
        workCenterId: args.workCenterId,
        jobOperationBatchId: args.jobOperationBatchId,
        trackedEntityId: args.trackedEntityId,
        error:
          operation.error ?? workCenter?.error ?? batch?.error ?? entity?.error
      }
    );
    return { ok: false, message: `${missing[0]} not found` };
  }

  return { ok: true };
}

export async function startProductionEvent(
  client: Client,
  data: {
    jobOperationId: string;
    type: ProductionEventType;
    workCenterId?: string;
    startTime: string;
    employeeId: string;
    companyId: string;
    createdBy: string;
    // Tags the event as part of an operation batch (sliced per-member at completion).
    jobOperationBatchId?: string;
  },
  trackedEntityId: string | undefined,
  unitIndex?: number,
  /** `mes_qr` when the operator scanned a traveller rather than tapping a station. */
  source: WorkSource = "mes"
) {
  const refs = await verifyProductionEventRefs(client, {
    companyId: data.companyId,
    jobOperationId: data.jobOperationId,
    workCenterId: data.workCenterId,
    jobOperationBatchId: data.jobOperationBatchId,
    trackedEntityId
  });
  if (!refs.ok) return notFoundResponse(refs.message);

  // A Setup or Labor timer the operator already has running on this operation
  // is returned, not started again: a double-tap, or a second device, would
  // otherwise count the labor twice. The partial unique index on open events
  // refuses an insert that races past this read; that start returns the
  // running timer too.
  const isTimer = data.type === "Setup" || data.type === "Labor";
  const runningTimer = async () => {
    const running = await client
      .from("productionEvent")
      .select("*")
      .eq("jobOperationId", data.jobOperationId)
      .eq("type", data.type)
      .eq("employeeId", data.employeeId)
      .eq("companyId", data.companyId)
      .is("endTime", null)
      .limit(1);
    if (running.error) return { data: null, error: running.error };
    const row = running.data[0];
    if (!row) return null;
    if (!trackedEntityId) return { data: [row], error: null };
    // A serial start must record that serial; a timer running for another
    // unit is refused rather than reported as this unit's start.
    return (await timerRecordsEntity(
      client,
      row.id,
      trackedEntityId,
      data.companyId
    ))
      ? { data: { id: row.id }, error: null }
      : conflictResponse(
          `A ${data.type.toLowerCase()} timer is already running on this operation for another unit. Stop it before starting this one.`
        );
  };
  const raced = (error: PostgrestError | null) =>
    isTimer && error?.code === UNIQUE_VIOLATION;

  if (isTimer) {
    const running = await runningTimer();
    if (running) return running;
  }

  if (trackedEntityId) {
    const activityId = nanoid();

    const [eventInsert, operation] = await Promise.all([
      client.from("productionEvent").insert(data).select("id").single(),
      client
        .from("jobOperation")
        .select("*")
        .eq("id", data.jobOperationId)
        .eq("companyId", data.companyId)
        .single()
    ]);

    if (eventInsert.error) {
      if (raced(eventInsert.error))
        return (await runningTimer()) ?? eventInsert;
      return eventInsert;
    }
    if (operation.error) return operation;

    const trackedActivityInsert = await client
      .from("trackedActivity")
      .insert({
        id: activityId,
        type: `${operation.data?.description} (${data.type})`,
        sourceDocument: "Production Event",
        sourceDocumentId: eventInsert.data?.id,
        attributes: {
          Job: operation.data?.jobId,
          "Job Operation": data.jobOperationId,
          "Production Event": eventInsert.data?.id,
          "Work Center": data.workCenterId,
          Employee: data.employeeId,
          // The unit this event built, so traceability can scope this activity's
          // step records to just this unit (see get_job_operation_step_records).
          ...(typeof unitIndex === "number" ? { Unit: unitIndex } : {})
        },
        companyId: data.companyId,
        createdBy: data.createdBy
      })
      .select("id")
      .single();

    if (trackedActivityInsert.error) {
      log.error("Failed to insert tracked activity", {
        error: trackedActivityInsert.error
      });
      return trackedActivityInsert;
    }

    const trackedActivityOutputInsert = await client
      .from("trackedActivityOutput")
      .insert({
        trackedActivityId: activityId,
        trackedEntityId,
        quantity: 1,
        companyId: data.companyId,
        createdBy: data.createdBy
      });

    if (trackedActivityOutputInsert.error) {
      log.error("Failed to insert tracked activity output", {
        error: trackedActivityOutputInsert.error
      });
      return trackedActivityOutputInsert;
    }

    await autoStartJobAndOperation(client, {
      jobOperationId: data.jobOperationId,
      userId: data.createdBy,
      companyId: data.companyId
    });

    trackWorkEvent("job_operation_started", {
      companyId: data.companyId,
      userId: data.createdBy,
      productionEventId: eventInsert.data.id,
      jobOperationId: data.jobOperationId,
      eventType: data.type,
      source
    });

    return eventInsert;
  }

  const eventInsert = await client
    .from("productionEvent")
    .insert(data)
    .select("*");

  if (raced(eventInsert.error)) return (await runningTimer()) ?? eventInsert;

  if (!eventInsert.error) {
    await autoStartJobAndOperation(client, {
      jobOperationId: data.jobOperationId,
      userId: data.createdBy,
      companyId: data.companyId
    });

    const inserted = eventInsert.data?.[0];
    if (inserted) {
      trackWorkEvent("job_operation_started", {
        companyId: data.companyId,
        userId: data.createdBy,
        productionEventId: inserted.id,
        jobOperationId: data.jobOperationId,
        eventType: data.type,
        source
      });
    }
  }

  return eventInsert;
}

/**
 * A Machine start on a work center: the press, which ends the work center's
 * open machine time, the new event and its tracked activity commit in one
 * transaction, at the press time read under the press locks. If any of it
 * fails, nothing was ended. Skips RLS: the caller checks that the user may
 * create production events first.
 */
export async function startMachineProductionEvent(
  db: Kysely<KyselyDatabase>,
  client: Client,
  data: Parameters<typeof startProductionEvent>[1] & { workCenterId: string },
  trackedEntityId: string | undefined,
  unitIndex?: number,
  source: WorkSource = "mes"
): Promise<{
  data: { id: string; endedEventIds: string[] } | null;
  error: unknown;
}> {
  const refs = await verifyProductionEventRefs(client, {
    companyId: data.companyId,
    jobOperationId: data.jobOperationId,
    workCenterId: data.workCenterId,
    jobOperationBatchId: data.jobOperationBatchId,
    trackedEntityId
  });
  if (!refs.ok) return notFoundResponse(refs.message);

  try {
    const started = await db.transaction().execute(async (trx) => {
      const press = await recordManualMachinePress(trx, {
        workCenterId: data.workCenterId,
        companyId: data.companyId,
        userId: data.createdBy
      });
      const inserted = await trx
        .insertInto("productionEvent")
        .values({ ...data, startTime: press.pressedAt })
        .returning("id")
        .executeTakeFirstOrThrow();

      if (trackedEntityId) {
        const operation = await trx
          .selectFrom("jobOperation")
          .select(["description", "jobId"])
          .where("id", "=", data.jobOperationId)
          .where("companyId", "=", data.companyId)
          .executeTakeFirstOrThrow();
        const activityId = nanoid();
        await trx
          .insertInto("trackedActivity")
          .values({
            id: activityId,
            type: `${operation.description} (${data.type})`,
            sourceDocument: "Production Event",
            sourceDocumentId: inserted.id,
            attributes: toJson({
              Job: operation.jobId,
              "Job Operation": data.jobOperationId,
              "Production Event": inserted.id,
              "Work Center": data.workCenterId,
              Employee: data.employeeId,
              ...(typeof unitIndex === "number" ? { Unit: unitIndex } : {})
            }),
            companyId: data.companyId,
            createdBy: data.createdBy
          })
          .execute();
        await trx
          .insertInto("trackedActivityOutput")
          .values({
            trackedActivityId: activityId,
            trackedEntityId,
            quantity: 1,
            companyId: data.companyId,
            createdBy: data.createdBy
          })
          .execute();
      }

      return { id: inserted.id, endedEventIds: press.endedEventIds };
    });

    await autoStartJobAndOperation(client, {
      jobOperationId: data.jobOperationId,
      userId: data.createdBy,
      companyId: data.companyId
    });
    trackWorkEvent("job_operation_started", {
      companyId: data.companyId,
      userId: data.createdBy,
      productionEventId: started.id,
      jobOperationId: data.jobOperationId,
      eventType: data.type,
      source
    });
    return { data: started, error: null };
  } catch (error) {
    log.error("Failed to start the Machine event", {
      companyId: data.companyId,
      workCenterId: data.workCenterId,
      error
    });
    return { data: null, error };
  }
}
