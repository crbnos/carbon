// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Result } from "@carbon/auth";
import { error } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { activeJobStatuses } from "@carbon/database";
import { evaluateLinesForSurface, isBlocked } from "@carbon/ee/rules.server";
import type { WorkSource } from "@carbon/lib/telemetry";
import { getLogger } from "@carbon/logger";
import type { ProductionEventType, StartEventBody } from "@carbon/mes-core";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkCenterWithBlockingStatus } from "~/services/maintenance.service";
import {
  endProductionEvent,
  finishJobOperation,
  getNextIncompleteSerialEntity,
  getOperationEligibility,
  getTrackedEntitiesByMakeMethodId,
  insertProductionQuantity,
  isSerialEntityIncompleteForOperation,
  startProductionEvent
} from "~/services/operations.service";
import { path } from "~/utils/path";
import type {
  CommandFailure,
  CommandResult,
  Failed
} from "./api-result.server";
import { failed, ok } from "./api-result.server";

/**
 * The time-event commands: starting and stopping a production timer, the
 * QR-traveller start, and the kanban scan completion.
 *
 * Extracted verbatim from `x+/event.tsx`, `x+/start.$operationId.tsx` and
 * `x+/end.$operationId.tsx` so the web MES and `/api/v1` run ONE code path.
 * See `commands.server.ts` for the contract every command here keeps.
 *
 * Two start paths, deliberately NOT merged:
 *   - `startEvent` is the in-app Start button (`x+/event.tsx`). It has the
 *     ability gate and nothing else — no floor gate, no blocked-work-center
 *     check, no `operationStart` rules — and it writes with the caller's own
 *     RLS-scoped client.
 *   - `startOperationFromScan` is the QR traveller (`x+/start/:id`). It carries
 *     the floor gate (which must run BEFORE the timer re-open), the
 *     blocked-work-center check and the `operationStart` rules, and it writes
 *     with the service role.
 * `POST /operations/:id/events` picks between them on `body.viaScan`.
 *
 * ## How a failure reaches the operator
 *
 * Every failure's `details` is the exact `Result` its web route flashes today,
 * built here by calling `error(cause, message)` — so the log line
 * (`error()` logs its cause) and the flash payload (including the `flash:
 * "error"` key, which `flash()` writes to its own session key) are both
 * byte-identical to the pre-extraction route. The web route hands `details`
 * straight to `flash()`; the API reads `message` and maps `kind` through
 * `FAILURE_STATUS`.
 */

const startLogger = getLogger("mes", "start-operation");
const endLogger = getLogger("mes", "end-operation");

/** Pack a web route's `Result` into a failure. See the file header. */
function flashFailure(
  kind: CommandFailure["kind"],
  result: Result,
  redirectTo?: string
): Failed {
  return failed({
    kind,
    // `Result.message` is optional in the type; `error()` always sets it,
    // defaulting to this very string.
    message: result.message ?? "Request failed",
    redirectTo,
    details: result
  });
}

// ---------------------------------------------------------------------------
// The in-app Start/Stop button (`x+/event.tsx`)
// ---------------------------------------------------------------------------

export type StartEventArgs = {
  companyId: string;
  /** Who the work is attributed to — the pinned operator, else the signed-in user. */
  userId: string;
  /** The signed-in user, for parity with `requirePermissions`' own split. */
  sessionUserId: string;
  /** Which surface posted it. Telemetry only; the row cannot tell. */
  source: WorkSource;
  body: StartEventBody & {
    /**
     * Tags the event as part of an operation batch (sliced per member at batch
     * completion). The web form sends it; `startEventBody` has no field for it
     * because the app does not clock a batch in v1.
     */
    jobOperationBatchId?: string;
  };
};

export type StartEventData = Awaited<
  ReturnType<typeof startProductionEvent>
>["data"];

export async function startEvent(
  client: SupabaseClient<Database>,
  args: StartEventArgs
): Promise<CommandResult<StartEventData>> {
  const { companyId, userId, source, body } = args;
  const {
    trackedEntityId,
    unitIndex,
    exclusive,
    viaScan: _viaScan,
    ...d
  } = body;

  // Ability gate: the shop-floor Start button posts here, so the
  // qualification check must run on this path (not only in the
  // start.$operationId loader)
  const serviceRole = await getCarbonServiceRole();
  const eligibility = await getOperationEligibility(serviceRole, {
    operationId: d.jobOperationId,
    employeeId: userId,
    companyId
  });
  if (!eligibility.eligible) {
    return flashFailure(
      "forbidden",
      error(null, eligibility.reason ?? "Not qualified to start this operation")
    );
  }

  // Single-phase (assembly) clocking: end any other open work type for this
  // operator on this operation before starting, so Setup and Labor can never
  // run simultaneously. Post each ended event so its cost still books.
  if (exclusive) {
    const openOthers = await client
      .from("productionEvent")
      .select("id")
      .eq("jobOperationId", d.jobOperationId)
      .eq("employeeId", userId)
      .is("endTime", null)
      .neq("type", d.type);
    if (openOthers.data && openOthers.data.length > 0) {
      const serviceRole = await getCarbonServiceRole();
      const endTime = datetime.timestamp();
      for (const ev of openOthers.data) {
        const ended = await endProductionEvent(client, {
          id: ev.id,
          endTime,
          employeeId: userId
        });
        if (ended.data && ended.data.length > 0) {
          await serviceRole.functions.invoke("post-production-event", {
            body: { productionEventId: ended.data[0].id, userId, companyId }
          });
        }
      }
    }
  }

  const startEventResult = await startProductionEvent(
    client,
    {
      ...d,
      startTime: datetime.timestamp(),
      employeeId: userId,
      companyId,
      createdBy: userId
    },
    trackedEntityId,
    unitIndex,
    source
  );

  if (startEventResult.error) {
    return flashFailure(
      "error",
      error(startEventResult.error, "Failed to start event")
    );
  }

  return ok(startEventResult.data);
}

export type EndEventArgs = {
  companyId: string;
  userId: string;
  sessionUserId: string;
  /** The `productionEvent` row to close. */
  eventId: string;
  /**
   * Accepted so every command takes the same scope arguments. Closing a timer
   * records no surface today — `endProductionEvent` writes no telemetry.
   */
  source: WorkSource;
  /**
   * Also close the operation's other open events for this operator — the end
   * counterpart of the Start branch's single-phase clocking, and the only
   * behaviour here the web does not use: `x+/event.tsx`'s Stop button closes
   * exactly the timer it names, so it never sends this. `endEventBody` in
   * `@carbon/mes-core` declares it for the app, whose Stop control owns the
   * whole operation rather than one work type.
   */
  exclusive?: boolean;
};

export type EndEventData = Awaited<
  ReturnType<typeof endProductionEvent>
>["data"];

export async function endEvent(
  client: SupabaseClient<Database>,
  args: EndEventArgs
): Promise<CommandResult<EndEventData>> {
  const { companyId, userId, eventId } = args;

  const endEventResult = await endProductionEvent(client, {
    id: eventId,
    endTime: datetime.timestamp(),
    employeeId: userId
  });
  if (endEventResult.error) {
    return flashFailure(
      "error",
      error(endEventResult.error, "Failed to end event")
    );
  }
  if (endEventResult.data && endEventResult.data.length > 0) {
    // Batch timers post cost at batch completion, when the aggregate event is
    // sliced per member (batch-operations edge fn). Posting it here too would
    // double-book the cost, so skip post-production-event for a batch event.
    if (!endEventResult.data[0].jobOperationBatchId) {
      const serviceRole = await getCarbonServiceRole();
      await serviceRole.functions.invoke("post-production-event", {
        body: {
          productionEventId: endEventResult.data[0].id,
          userId,
          companyId
        }
      });
    }
  }

  const ended = endEventResult.data?.[0];
  if (args.exclusive && ended?.jobOperationId) {
    const endTime = datetime.timestamp();
    const openOthers = await client
      .from("productionEvent")
      .select("id")
      .eq("jobOperationId", ended.jobOperationId)
      .eq("employeeId", userId)
      .is("endTime", null)
      .neq("id", ended.id);
    const serviceRole = await getCarbonServiceRole();
    for (const ev of openOthers.data ?? []) {
      const alsoEnded = await endProductionEvent(client, {
        id: ev.id,
        endTime,
        employeeId: userId
      });
      const row = alsoEnded.data?.[0];
      if (row && !row.jobOperationBatchId) {
        await serviceRole.functions.invoke("post-production-event", {
          body: { productionEventId: row.id, userId, companyId }
        });
      }
    }
  }

  return ok(endEventResult.data);
}

// ---------------------------------------------------------------------------
// The QR traveller start (`x+/start.$operationId.tsx`)
// ---------------------------------------------------------------------------

export type StartOperationFromScanArgs = {
  companyId: string;
  userId: string;
  sessionUserId: string;
  operationId: string;
  type: ProductionEventType;
  trackedEntityId?: string;
  /** The operator confirmed a warning-level rule violation. */
  acknowledged?: boolean;
  source: WorkSource;
};

export async function startOperationFromScan(
  serviceRole: SupabaseClient<Database>,
  args: StartOperationFromScanArgs
): Promise<CommandResult<{ operationId: string }>> {
  const {
    companyId,
    userId,
    operationId,
    type,
    acknowledged = false,
    source
  } = args;
  let trackedEntityId: string | null = args.trackedEntityId ?? null;

  const jobOperation = await serviceRole
    .from("jobOperation")
    .select("*")
    .eq("id", operationId)
    .maybeSingle();

  if (jobOperation.error || !jobOperation.data) {
    return flashFailure(
      "not_found",
      error(jobOperation.error, "Failed to fetch job operation"),
      path.to.operations
    );
  }

  if (jobOperation.data?.companyId !== companyId) {
    startLogger.warn("Job operation does not belong to company", {
      companyId,
      operationId
    });
    return flashFailure(
      "forbidden",
      error("You are not authorized to start this operation", "Unauthorized"),
      path.to.operations
    );
  }

  // Floor rule: an operation is startable iff it is floor-visible — a batched
  // op needs its batch released (not Planned); an unbatched op needs its job
  // released (Ready/In Progress/Paused). These guards must run BEFORE the
  // productionEvent re-open below so a not-released op never mutates timers.
  if (jobOperation.data.jobOperationBatchId) {
    const batch = await serviceRole
      .from("jobOperationBatch")
      .select("status")
      .eq("id", jobOperation.data.jobOperationBatchId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (batch.data?.status === "Planned") {
      return flashFailure(
        "conflict",
        error(
          null,
          "This operation is part of a batch that has not been released to the floor"
        ),
        path.to.operations
      );
    }
  } else {
    const job = await serviceRole
      .from("job")
      .select("status")
      .eq("id", jobOperation.data.jobId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (
      !job.data?.status ||
      !(activeJobStatuses as readonly string[]).includes(job.data.status)
    ) {
      return flashFailure(
        "conflict",
        error(null, "This operation's job has not been released to the floor"),
        path.to.operations
      );
    }
  }

  // Re-open any still-running timers for this operation (touches updatedBy so
  // realtime subscribers refresh).
  await serviceRole
    .from("productionEvent")
    .update({
      endTime: null,
      updatedBy: userId
    })
    .eq("jobOperationId", operationId)
    .is("endTime", null);

  // Check if work center is blocked for maintenance
  if (jobOperation.data.workCenterId) {
    const workCenterStatus = await getWorkCenterWithBlockingStatus(
      serviceRole,
      jobOperation.data.workCenterId
    );

    if (workCenterStatus.data?.isBlocked) {
      return flashFailure(
        "conflict",
        error(
          `Work center is blocked for maintenance (${workCenterStatus.data.blockingDispatchReadableId})`,
          "Work Center Blocked"
        ),
        path.to.operation(operationId)
      );
    }
  }

  // Check if the operator is qualified for the operation's required abilities
  const eligibility = await getOperationEligibility(serviceRole, {
    operationId,
    employeeId: userId,
    companyId
  });

  if (!eligibility.eligible) {
    return flashFailure(
      "forbidden",
      error(null, eligibility.reason ?? "Not qualified to start operation"),
      path.to.operation(operationId)
    );
  }

  // Get tracked entities if jobMakeMethodId exists
  if (!trackedEntityId && jobOperation.data.jobMakeMethodId) {
    const trackedEntities = await getTrackedEntitiesByMakeMethodId(
      serviceRole,
      jobOperation.data.jobMakeMethodId,
      companyId
    );

    // Start the next incomplete serial unit for this operation (createdAt asc),
    // falling back to the last entity when every unit is already complete.
    const nextTrackedEntity = getNextIncompleteSerialEntity(
      trackedEntities.data ?? [],
      operationId
    );
    if (nextTrackedEntity) {
      trackedEntityId = nextTrackedEntity.id;
    }
  }

  // Business-rule pre-flight (workCenter target, operationStart surface).
  // Hard errors abort; warnings flash but allow (loader-only flow has no
  // modal to ack against).
  if (jobOperation.data.workCenterId) {
    const ruleEval = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      targetType: "workCenter",
      surface: "operationStart",
      lines: [
        {
          lineId: operationId,
          itemId: null,
          workCenterId: jobOperation.data.workCenterId,
          operation: {
            id: operationId,
            itemId: null,
            quantity: jobOperation.data.operationQuantity ?? null,
            workInstructionId:
              (jobOperation.data as { workInstructionId?: string | null })
                .workInstructionId ?? null
          },
          quantity: jobOperation.data.operationQuantity ?? 0
        }
      ]
    });
    if (
      ruleEval.violations.length > 0 &&
      isBlocked(ruleEval.violations, acknowledged)
    ) {
      return flashFailure(
        "blocked",
        error(
          ruleEval.violations[0]?.message ?? "Rule violation",
          "Cannot start operation"
        ),
        path.to.operation(operationId)
      );
    }
  }

  // If type is Machine, cancel all setup and labor production events for this operation
  if (type === "Machine") {
    const currentTime = datetime.timestamp();

    await serviceRole
      .from("productionEvent")
      .update({
        endTime: currentTime,
        updatedAt: currentTime,
        updatedBy: userId
      })
      .eq("jobOperationId", operationId)
      .in("type", ["Setup", "Labor"])
      .is("endTime", null);
  }

  const startEventResult = await startProductionEvent(
    serviceRole,
    {
      type,
      jobOperationId: operationId,
      workCenterId: jobOperation.data.workCenterId!,
      startTime: datetime.timestamp(),
      employeeId: userId,
      companyId,
      createdBy: userId
    },
    trackedEntityId || undefined,
    undefined,
    source
  );

  if (startEventResult.error) {
    return flashFailure(
      "error",
      error(startEventResult.error, "Failed to start event"),
      path.to.operations
    );
  }

  return ok({ operationId });
}

// ---------------------------------------------------------------------------
// The kanban scan completion (`x+/end.$operationId.tsx`)
// ---------------------------------------------------------------------------

export type CompleteOperationFromScanArgs = {
  companyId: string;
  userId: string;
  sessionUserId: string;
  operationId: string;
  trackedEntityId?: string;
  acknowledged?: boolean;
  source: WorkSource;
};

export type CompleteOperationFromScanData =
  /** A serial unit was completed and the next one is ready to work on. */
  | { outcome: "advance"; trackedEntityId: string }
  /** The operation reached its target and was flipped to Done. */
  | { outcome: "finished" }
  /** A part was completed; the operation stays open. */
  | { outcome: "completed" };

/**
 * Deliberately UNGATED — no floor gate and no blocked-work-center check.
 * Closing out work that was physically done is never refused; only the
 * `operationFinish` rules apply, and only when this scan finishes the
 * operation (`.claude/rules/mes-job-operation-ui.md`).
 */
export async function completeOperationFromScan(
  serviceRole: SupabaseClient<Database>,
  args: CompleteOperationFromScanArgs
): Promise<CommandResult<CompleteOperationFromScanData>> {
  const { companyId, userId, operationId, acknowledged = false, source } = args;
  let trackedEntityId: string | null = args.trackedEntityId ?? null;

  const [jobOperation, productionQuantities] = await Promise.all([
    serviceRole
      .from("jobOperation")
      .select("*, ...process(completeAllOnScan)")
      .eq("id", operationId)
      .maybeSingle(),
    serviceRole
      .from("productionQuantity")
      .select("*")
      .eq("type", "Production")
      .eq("jobOperationId", operationId)
  ]);

  if (
    jobOperation.error ||
    !jobOperation.data ||
    !jobOperation.data.jobMakeMethodId
  ) {
    return flashFailure(
      "not_found",
      {
        ...error(jobOperation.error, "Failed to fetch job operation"),
        flash: "error"
      },
      path.to.operations
    );
  }

  if (jobOperation.data?.companyId !== companyId) {
    endLogger.warn("Job operation does not belong to company", {
      companyId,
      operationId
    });
    return flashFailure(
      "forbidden",
      {
        ...error(
          "You are not authorized to start this operation",
          "Unauthorized"
        ),
        flash: "error"
      },
      path.to.operations
    );
  }
  const completeAll = jobOperation.data?.completeAllOnScan ?? false;

  const [jobMakeMethod] = await Promise.all([
    serviceRole
      .from("jobMakeMethod")
      .select("*")
      .eq("id", jobOperation.data.jobMakeMethodId)
      .maybeSingle()
  ]);

  if (jobMakeMethod.error || !jobMakeMethod.data) {
    return flashFailure(
      "not_found",
      error(jobMakeMethod.error, "Failed to fetch job make method"),
      path.to.operations
    );
  }

  const currentQuantity =
    productionQuantities.data?.reduce((acc, curr) => acc + curr.quantity, 0) ??
    0;

  const quantityToComplete = completeAll
    ? Math.max(
        0,
        (jobOperation.data.operationQuantity ?? 0) -
          currentQuantity -
          (jobOperation.data.quantityReworked ?? 0)
      )
    : 1;

  const willBeFinished =
    quantityToComplete + currentQuantity >=
    (jobOperation.data.targetQuantity ??
      jobOperation.data.operationQuantity ??
      0);

  const isTrackedEntity =
    jobMakeMethod.data.requiresSerialTracking ||
    jobMakeMethod.data.requiresBatchTracking;

  // Business-rule pre-flight on operationFinish. Only fires when this scan
  // actually closes the operation (`willBeFinished`); transient quantity
  // events don't trigger finish rules.
  if (willBeFinished && jobOperation.data.workCenterId) {
    const ruleEval = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      targetType: "workCenter",
      surface: "operationFinish",
      lines: [
        {
          lineId: operationId,
          itemId: jobMakeMethod.data.itemId as string | null,
          workCenterId: jobOperation.data.workCenterId,
          operation: {
            id: operationId,
            itemId: jobMakeMethod.data.itemId as string | null,
            quantity: jobOperation.data.operationQuantity ?? null,
            workInstructionId:
              (jobOperation.data as { workInstructionId?: string | null })
                .workInstructionId ?? null
          },
          quantity: quantityToComplete
        }
      ]
    });
    if (
      ruleEval.violations.length > 0 &&
      isBlocked(ruleEval.violations, acknowledged)
    ) {
      return flashFailure(
        "blocked",
        error(
          ruleEval.violations[0]?.message ?? "Rule violation",
          "Cannot finish operation"
        ),
        path.to.operation(operationId)
      );
    }
  }

  if (quantityToComplete > 0) {
    if (isTrackedEntity) {
      if (!trackedEntityId) {
        const trackedEntities = await getTrackedEntitiesByMakeMethodId(
          serviceRole,
          jobOperation.data.jobMakeMethodId,
          companyId
        );

        // Complete the next incomplete serial unit for this operation (createdAt
        // asc), falling back to the last entity when every unit is complete.
        const nextTrackedEntity = getNextIncompleteSerialEntity(
          trackedEntities.data ?? [],
          operationId
        );
        if (nextTrackedEntity) {
          trackedEntityId = nextTrackedEntity.id;
        }
      }

      if (jobMakeMethod.data.requiresSerialTracking) {
        const response = await serviceRole.functions.invoke("issue", {
          body: {
            type: "jobOperationSerialComplete",
            quantity: 1,
            jobOperationId: jobOperation.data.id,
            trackedEntityId,
            trackingType: "Serial",
            notes: "Generated by QR code",
            companyId,
            userId
          }
        });

        const newTrackedEntityId = response.data?.newTrackedEntityId;

        if (newTrackedEntityId) {
          return ok({
            outcome: "advance",
            trackedEntityId: newTrackedEntityId
          });
        }

        if (willBeFinished) {
          const finishOperation = await finishJobOperation(serviceRole, {
            jobOperationId: jobOperation.data.id,
            userId,
            companyId
          });

          if (finishOperation.error) {
            return flashFailure(
              "error",
              error(finishOperation.error, "Failed to finish operation"),
              path.to.operation(operationId)
            );
          }

          return ok({ outcome: "finished" });
        }

        // Pre-split flow: the issue function did not spawn a new entity (all
        // units already exist), so advance to the next incomplete serial unit
        // for this operation. When none remain, fall through to the shared
        // "operation complete" outcome below.
        const remainingTrackedEntities = await getTrackedEntitiesByMakeMethodId(
          serviceRole,
          jobOperation.data.jobMakeMethodId,
          companyId
        );
        const nextTrackedEntity = (remainingTrackedEntities.data ?? []).find(
          (entity) => isSerialEntityIncompleteForOperation(entity, operationId)
        );
        if (nextTrackedEntity) {
          return ok({
            outcome: "advance",
            trackedEntityId: nextTrackedEntity.id
          });
        }
      } else if (jobMakeMethod.data.requiresBatchTracking) {
        const response = await serviceRole.functions.invoke("issue", {
          body: {
            type: "jobOperationBatchComplete",
            quantity: quantityToComplete,
            jobOperationId: jobOperation.data.id,
            trackedEntityId,
            trackingType: "Batch",
            notes: "Generated by QR code",
            companyId,
            userId
          }
        });

        if (response.error) {
          return flashFailure(
            "error",
            {
              ...error(response.error, "Failed to complete job operation"),
              flash: "error"
            },
            path.to.operation(operationId)
          );
        }
      }
    } else {
      const insertProduction = await insertProductionQuantity(
        serviceRole,
        {
          quantity: quantityToComplete,
          jobOperationId: jobOperation.data.id,
          notes: "Generated by QR code",
          companyId,
          createdBy: userId
        },
        source
      );

      if (insertProduction.error) {
        return flashFailure(
          "error",
          {
            ...error(
              insertProduction.error,
              "Failed to record production quantity"
            ),
            flash: "error"
          },
          path.to.operation(operationId)
        );
      }

      const issue = await serviceRole.functions.invoke("issue", {
        body: {
          id: operationId,
          type: "jobOperation",
          quantity: quantityToComplete,
          companyId,
          userId
        }
      });

      if (issue.error) {
        return flashFailure(
          "error",
          {
            ...error(issue.error, "Failed to issue materials"),
            flash: "error"
          },
          path.to.operation(operationId)
        );
      }
    }
  }

  if (willBeFinished) {
    const finishOperation = await finishJobOperation(serviceRole, {
      jobOperationId: jobOperation.data.id,
      userId,
      companyId
    });

    if (finishOperation.error) {
      return flashFailure(
        "error",
        {
          ...error(finishOperation.error, "Failed to finish operation"),
          flash: "error"
        },
        path.to.operation(operationId)
      );
    }

    return ok({ outcome: "finished" });
  }

  return ok({ outcome: "completed" });
}
