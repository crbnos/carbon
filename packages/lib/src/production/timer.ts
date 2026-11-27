// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A shop-floor timer Start and End: one body for the MES buttons
// (`apps/mes/app/services/production-event.server.ts`) and the ERP's API and
// MCP tools (`production_startOperationTimer`, `production_endOperationTimer`).
// The functions take clients and plain input, return a result, and never read
// a request or write a flash. The caller posts what an End ended.
//
// Not named `.server`: MES service files sit in the client graph (components
// import their types), and a `.server` specifier fails the React Router build.

import type { Database } from "@carbon/database";
import type { PageGate } from "@carbon/database/access";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { abilityBlockRefusal } from "./ability";
import {
  endMachineProductionEvent,
  endProductionEvent,
  type ProductionEventType,
  startMachineProductionEvent,
  startProductionEvent
} from "./event-writes";
import {
  floorCheck,
  maintenanceBlock,
  maintenanceRefusal,
  workCenterRefusal
} from "./floor";
import { OUTSIDE_PROCESSING_REFUSAL } from "./shop-floor";
import { resolveWorkUnit } from "./work-unit-resolve";

type Client = SupabaseClient<Database>;

export type TimerRefusal = {
  ok: false;
  category: "forbidden" | "notFound" | "rule" | "conflict" | "internal";
  /** What the MES toast says. */
  message: string;
  /** The write's own reason, when it is written for the user (an API reply). */
  reason?: string;
  cause?: unknown;
};

const refuse = (
  category: TimerRefusal["category"],
  message: string,
  extra: Pick<TimerRefusal, "reason" | "cause"> = {}
): TimerRefusal => ({ ok: false, category, message, ...extra });

/** A failed timer write as a refusal: a foreign id, or a timer for another unit. */
function writeRefusal(message: string, error: unknown): TimerRefusal {
  const code = (error as { code?: string } | null)?.code;
  const reason = (error as { message?: string } | null)?.message;
  if (code === "PGRST116")
    return refuse("notFound", message, { reason, cause: error });
  if (code === "PGRST409")
    return refuse("conflict", message, { reason, cause: error });
  return refuse("internal", message, { cause: error });
}

export type TimerDeps = {
  /** The caller: row-level security applies. */
  client: Client;
  /** Reads the gates (the operation, the job, the abilities, the units). */
  serviceRole: Client;
  /** The Machine press, which skips row-level security. */
  db: () => Kysely<KyselyDatabase>;
  /** Whether the caller holds a gate (a Machine press). */
  permitted: (gate: PageGate) => boolean | Promise<boolean>;
  /** Numbers a unit on its first touch (`numberUnitOnFirstTouch`). */
  numberUnit: (args: {
    trackedEntityId: string;
    jobOperationId: string;
    companyId: string;
  }) => Promise<unknown>;
  /** Posts the events a Start or End ended (their cost to WIP). */
  postEnded: (ids: string[]) => Promise<unknown>;
};

export type StartTimerInput = {
  companyId: string;
  /** Whose time it is: always the signed-in caller, never an input field. */
  employeeId: string;
  jobOperationId: string;
  type: ProductionEventType;
  /** Defaults to the operation's; another must run the operation's process. */
  workCenterId?: string;
  /** The unit the screen held; dropped when it is not open here. */
  trackedEntityId?: string;
  /** Assembly screen: the unit-axis place, when no serial unit is named. */
  unitIndex?: number;
  /** Assembly screen: end the caller's other open types on the operation first. */
  exclusive?: boolean;
};

/**
 * Starts a timer: the checks a shop-floor Start runs, in order, then the
 * write. Refused before anything is written for a Machine press without
 * `production.jobs` Create, Outside Processing, an operation not on the floor,
 * a work center that does not run the operation's process, a work center
 * blocked for maintenance, a missing required ability (Block policy) or a
 * unit the operation cannot run.
 */
export async function startOperationTimer(
  deps: TimerDeps,
  input: StartTimerInput
) {
  const { client, serviceRole } = deps;
  const { companyId, employeeId, jobOperationId, type } = input;

  const operation = await serviceRole
    .from("jobOperation")
    .select(
      "operationType, jobId, jobOperationBatchId, workCenterId, processId"
    )
    .eq("id", jobOperationId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (operation.error) {
    return refuse("internal", "Failed to start event", {
      cause: operation.error
    });
  }
  if (!operation.data) return refuse("notFound", "Job operation not found");
  const workCenterId =
    input.workCenterId ?? operation.data.workCenterId ?? undefined;

  // A Machine press writes over Kysely, which skips RLS, so the permission RLS
  // would check is checked here, before anything is written.
  const machineWorkCenterId = type === "Machine" ? workCenterId : undefined;
  if (
    machineWorkCenterId &&
    !(await deps.permitted({ "production.jobs": "Create" }))
  ) {
    return refuse(
      "forbidden",
      "You do not have permission to start machine time"
    );
  }
  if (operation.data.operationType === "Outside Processing") {
    return refuse("rule", OUTSIDE_PROCESSING_REFUSAL);
  }

  // The screens disable Start where these refuse; an API Start has no screen
  // in front of it. Independent reads, refused in this order.
  const [floor, wrongWorkCenter, blocked, abilityRefusal] = await Promise.all([
    floorCheck(serviceRole, {
      companyId,
      jobId: operation.data.jobId,
      jobOperationBatchId: operation.data.jobOperationBatchId
    }),
    workCenterId
      ? workCenterRefusal(serviceRole, {
          companyId,
          workCenterId,
          operation: operation.data
        })
      : null,
    workCenterId
      ? maintenanceBlock(serviceRole, { companyId, workCenterId })
      : null,
    abilityBlockRefusal(serviceRole, {
      operationId: jobOperationId,
      employeeId,
      companyId
    })
  ]);
  if (floor.refusal) return refuse("rule", floor.refusal);
  if (wrongWorkCenter) return refuse("rule", wrongWorkCenter);
  if (blocked) return refuse("rule", maintenanceRefusal(blocked));
  if (abilityRefusal) return refuse("rule", abilityRefusal);

  // A timer names a unit only when the screen held one open here. With
  // none, or one done here, a first operation runs on the next open unit
  // and a later operation names none.
  const work = await resolveWorkUnit({
    client: serviceRole,
    companyId,
    operationId: jobOperationId,
    requestedUnitId: input.trackedEntityId,
    mode: "optional"
  });
  if (work.kind === "refuse") return refuse("rule", work.message);
  // Not serial: a batch lot passes through (`lotId`).
  const unitId = work.kind === "unit" ? work.unitId : work.lotId;
  const unitAt = work.kind === "unit" ? work.unitIndex : input.unitIndex;
  // The unit the screen named is not open here: say what the timer runs on.
  const dropped = !!input.trackedEntityId && unitId !== input.trackedEntityId;

  // Single-phase (assembly) clocking: end any other open work type for this
  // operator on this operation before starting, so Setup and Labor can never
  // run simultaneously. Post each ended event so its cost still books.
  if (input.exclusive) {
    const openOthers = await client
      .from("productionEvent")
      .select("id")
      .eq("jobOperationId", jobOperationId)
      .eq("employeeId", employeeId)
      .eq("companyId", companyId)
      .is("endTime", null)
      .neq("type", type);
    if (openOthers.data && openOthers.data.length > 0) {
      const endTime = datetime.timestamp();
      const ended: string[] = [];
      for (const ev of openOthers.data) {
        const result = await endProductionEvent(client, {
          id: ev.id,
          endTime,
          employeeId,
          companyId
        });
        const row = result.data?.[0];
        if (row) ended.push(row.id);
      }
      await deps.postEnded(ended);
    }
  }

  // A member of a running batch clocks the batch's shared timer, whoever starts it.
  const inRunningBatch =
    floor.batchStatus === "Active" || floor.batchStatus === "Completing";
  const event = {
    jobOperationId,
    type,
    workCenterId,
    jobOperationBatchId: inRunningBatch
      ? (operation.data.jobOperationBatchId ?? undefined)
      : undefined,
    startTime: datetime.timestamp(),
    employeeId,
    companyId,
    createdBy: employeeId
  };
  const startEvent = machineWorkCenterId
    ? await startMachineProductionEvent(
        deps.db(),
        client,
        { ...event, workCenterId: machineWorkCenterId },
        unitId,
        unitAt
      )
    : await startProductionEvent(client, event, unitId, unitAt);

  if (startEvent.error) {
    return writeRefusal("Failed to start event", startEvent.error);
  }
  if (startEvent.data && "endedEventIds" in startEvent.data) {
    await deps.postEnded(startEvent.data.endedEventIds);
  }

  if (unitId) {
    await deps.numberUnit({
      trackedEntityId: unitId,
      jobOperationId,
      companyId
    });
  }

  const started = startEvent.data;
  const eventId = Array.isArray(started) ? started[0]?.id : started?.id;
  return {
    ok: true as const,
    /** The write's own result, as the MES route returns it. */
    event: started,
    eventId: eventId ?? null,
    unitId: unitId ?? null,
    dropped
  };
}

/**
 * Ends a running timer on the event's own work center and type. A Machine
 * End is a press (`production.jobs` Edit): it ends every open Machine event on
 * the work center. Never blocked by the floor rule: time already running must
 * always stop.
 */
export async function endOperationTimer(
  deps: TimerDeps,
  input: { companyId: string; userId: string; eventId: string }
) {
  const { client } = deps;
  const { companyId, userId, eventId } = input;
  const event = await client
    .from("productionEvent")
    .select("workCenterId, type, endTime")
    .eq("id", eventId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (event.error) {
    return refuse("internal", "Failed to end event", { cause: event.error });
  }
  if (!event.data) {
    return refuse("notFound", "Failed to end event", {
      reason: "Production event not found"
    });
  }
  const { type } = event.data;
  // A repeated End must not end it again, nor end a newer event through the
  // press.
  if (event.data.endTime) {
    return refuse("conflict", "This event has already ended");
  }

  if (type === "Machine" && event.data.workCenterId) {
    if (!(await deps.permitted({ "production.jobs": "Edit" }))) {
      return refuse(
        "forbidden",
        "You do not have permission to end machine time"
      );
    }
    let press: Awaited<ReturnType<typeof endMachineProductionEvent>>;
    try {
      press = await endMachineProductionEvent(deps.db(), {
        id: eventId,
        workCenterId: event.data.workCenterId,
        companyId,
        userId
      });
    } catch (error) {
      return refuse("internal", "Failed to end event", { cause: error });
    }
    if (!press) return refuse("conflict", "This event has already ended");
    // The press ended this event with every other one on the work center.
    await deps.postEnded(press.endedEventIds);
    const ended = await client
      .from("productionEvent")
      .select("*")
      .eq("id", eventId)
      .eq("companyId", companyId);
    return {
      ok: true as const,
      event: ended.data,
      type,
      endedEventIds: press.endedEventIds
    };
  }

  const endEvent = await endProductionEvent(client, {
    id: eventId,
    endTime: datetime.timestamp(),
    employeeId: userId,
    companyId
  });
  if (endEvent.error) {
    return refuse("internal", "Failed to end event", { cause: endEvent.error });
  }
  const ended = endEvent.data?.[0];
  if (!ended) {
    // Open when read, but the update matched nothing: another End won the
    // race, or RLS refused the update.
    return refuse(
      "conflict",
      "This event has already ended, or you cannot end it"
    );
  }
  // Batch timers post cost at batch completion, when the aggregate event is
  // sliced per member (batch-operations). The caller's `postEnded` skips a
  // batch event, so posting here never double-books its cost.
  await deps.postEnded([ended.id]);
  return {
    ok: true as const,
    event: endEvent.data,
    type,
    endedEventIds: [ended.id]
  };
}
