// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The kanban Start and Complete scans (`x+/start.$operationId.tsx`,
// `x+/end.$operationId.tsx`): a GET from the MES kanban wedge, the ERP kanban
// card or a printed traveler QR, which names a unit only when the screen held
// one. The routes authenticate and pass their clients in.

import { error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { activeJobStatuses } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { evaluateLinesForSurface, isBlocked } from "@carbon/ee/rules.server";
import { getLogger } from "@carbon/logger";
import { datetime, redirect } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { erpPosting } from "~/services/erp";
import { getWorkCenterWithBlockingStatus } from "~/services/maintenance.service";
import {
  abilityBlockRefusal,
  finishJobOperation,
  getRequiredScanShortfall,
  getTrackedEntitiesForOperation,
  insertProductionQuantity,
  isSerialEntityIncompleteForOperation,
  postEndedProductionEvents,
  startMachineProductionEvent,
  startProductionEvent
} from "~/services/operations.service";
import { autoPrintOperationLabel } from "~/services/printing.server";
import {
  checkStrictBackflush,
  generateFirstArticlesForStartedJob
} from "~/services/quality.server";
import { assignSerialNumberOnFirstTouch } from "~/services/serial-number.server";
import { resolveWorkUnit } from "~/services/work-unit.server";
import { OUTSIDE_PROCESSING_REFUSAL } from "~/utils/operationView";
import { path } from "~/utils/path";

const logger = getLogger("mes", "kanban-scan");

export type KanbanScanDeps = {
  /** The service role. */
  client: SupabaseClient<Database>;
  db: () => Kysely<KyselyDatabase>;
  post: typeof erpPosting;
  /** Throws unless the caller may write machine time. */
  requireMachinePermission: () => Promise<unknown>;
};

type ScanArgs = {
  request: Request;
  companyId: string;
  userId: string;
  operationId: string;
};

/** Starts a timer on the operation (the kanban Start card). Throws a redirect. */
export async function startOperationByScan(
  deps: KanbanScanDeps,
  { request, companyId, userId, operationId }: ScanArgs
): Promise<never> {
  const url = new URL(request.url);
  const serviceRole = deps.client;

  let type = (url.searchParams.get("type") ?? "Labor") as
    | "Setup"
    | "Labor"
    | "Machine";
  if (!["Setup", "Labor", "Machine"].includes(type)) {
    type = "Labor";
  }

  const jobOperation = await serviceRole
    .from("jobOperation")
    .select("*")
    .eq("id", operationId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (jobOperation.error || !jobOperation.data) {
    throw redirect(
      path.to.operations,
      await flash(
        request,
        error(jobOperation.error, "Failed to fetch job operation")
      )
    );
  }

  // Subcontracted work runs at the supplier and is never startable here. Like
  // the floor rule below, this must run BEFORE the timer re-open.
  if (jobOperation.data.operationType === "Outside Processing") {
    throw redirect(
      path.to.operations,
      await flash(request, error(null, OUTSIDE_PROCESSING_REFUSAL))
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
      throw redirect(
        path.to.operations,
        await flash(
          request,
          error(
            null,
            "This operation is part of a batch that has not been released to the floor"
          )
        )
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
      throw redirect(
        path.to.operations,
        await flash(
          request,
          error(null, "This operation's job has not been released to the floor")
        )
      );
    }
  }

  // The unit the timer runs on, before any timer is touched. A later
  // operation with several open units and none named starts with no unit.
  const work = await resolveWorkUnit({
    client: serviceRole,
    companyId,
    operationId,
    requestedUnitId: url.searchParams.get("trackedEntityId"),
    mode: "start"
  });
  if (work.kind === "refuse") {
    throw redirect(
      path.to.operation(operationId),
      await flash(request, error(null, work.message))
    );
  }
  const trackedEntityId =
    work.kind === "unit" ? work.unitId : (work.lotId ?? null);

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
      throw redirect(
        path.to.operation(operationId),
        await flash(
          request,
          error(
            `Work center is blocked for maintenance (${workCenterStatus.data.blockingDispatchReadableId})`,
            "Work Center Blocked"
          )
        )
      );
    }
  }

  // Refuse when the process requires an ability the operator lacks and its
  // policy is Block
  const abilityRefusal = await abilityBlockRefusal(serviceRole, {
    operationId,
    employeeId: userId,
    companyId
  });
  if (abilityRefusal) {
    throw redirect(
      path.to.operation(operationId),
      await flash(request, error(null, abilityRefusal))
    );
  }

  // Business-rule pre-flight (workCenter target, operationStart surface).
  // Hard errors abort; warnings flash but allow (loader-only flow has no
  // modal to ack against).
  if (jobOperation.data.workCenterId) {
    const acknowledged = url.searchParams.get("acknowledged") === "true";
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
      throw redirect(
        path.to.operation(operationId),
        await flash(
          request,
          error(
            ruleEval.violations[0]?.message ?? "Rule violation",
            "Cannot start operation"
          )
        )
      );
    }
  }

  // A machine has one machine time: a Machine start ends every open Machine
  // event on the work center (from any operator or the sensor) and, with a
  // device, the open unattributed time, in one transaction with the new
  // event. That write skips RLS, so its permission is checked first.
  const machineWorkCenterId =
    type === "Machine" ? jobOperation.data.workCenterId : null;
  if (machineWorkCenterId) {
    await deps.requireMachinePermission();
  }

  const event = {
    type,
    jobOperationId: operationId,
    workCenterId: jobOperation.data.workCenterId!,
    startTime: datetime.timestamp(),
    employeeId: userId,
    companyId,
    createdBy: userId
  };
  // A scan that auto-starts a Draft / Planned job released it: create its
  // first article lots, as every release does.
  const onJobReleased = (jobId: string) =>
    generateFirstArticlesForStartedJob(serviceRole, {
      jobId,
      companyId,
      userId
    });
  const startEvent = machineWorkCenterId
    ? await startMachineProductionEvent(
        deps.db(),
        serviceRole,
        { ...event, workCenterId: machineWorkCenterId },
        trackedEntityId || undefined,
        undefined,
        "mes_qr",
        onJobReleased
      )
    : await startProductionEvent(
        serviceRole,
        event,
        trackedEntityId || undefined,
        undefined,
        "mes_qr",
        onJobReleased
      );

  if (startEvent.error) {
    throw redirect(
      path.to.operations,
      await flash(request, error(startEvent.error, "Failed to start event"))
    );
  }

  // A Machine start ends this operation's Setup and Labor timers, once the
  // Machine time is running. Every event ended here is posted.
  const ended =
    startEvent.data && "endedEventIds" in startEvent.data
      ? [...startEvent.data.endedEventIds]
      : [];
  if (type === "Machine") {
    const endTime = datetime.timestamp();
    const setupAndLabor = await serviceRole
      .from("productionEvent")
      .update({ endTime, updatedAt: endTime, updatedBy: userId })
      .eq("jobOperationId", operationId)
      .eq("companyId", companyId)
      .in("type", ["Setup", "Labor"])
      .is("endTime", null)
      .select("id");
    if (setupAndLabor.error) {
      logger.error("Failed to end Setup and Labor at a Machine start", {
        companyId,
        operationId,
        error: setupAndLabor.error
      });
    }
    for (const row of setupAndLabor.data ?? []) ended.push(row.id);
  }
  await postEndedProductionEvents(serviceRole, {
    companyId,
    userId,
    ids: ended
  });

  // First touch: number the unit if it has no serial number yet.
  if (work.kind === "unit") {
    await assignSerialNumberOnFirstTouch({
      trackedEntityId: work.unitId,
      jobOperationId: operationId,
      companyId
    });
  }

  throw redirect(path.to.operation(operationId));
}

/** Completes a unit (or the scan's quantity) at the operation (the kanban Complete card). */
export async function endOperationByScan(
  deps: Pick<KanbanScanDeps, "client" | "post">,
  { request, companyId, userId, operationId }: ScanArgs
) {
  const url = new URL(request.url);
  const requestedUnitId = url.searchParams.get("trackedEntityId");
  const serviceRole = deps.client;

  const [jobOperation, productionQuantities] = await Promise.all([
    serviceRole
      .from("jobOperation")
      .select("*, ...process(completeAllOnScan)")
      .eq("id", operationId)
      .eq("companyId", companyId)
      .maybeSingle(),
    serviceRole
      .from("productionQuantity")
      .select("*")
      .eq("type", "Production")
      .eq("jobOperationId", operationId)
      .eq("companyId", companyId)
  ]);

  if (
    jobOperation.error ||
    !jobOperation.data ||
    !jobOperation.data.jobMakeMethodId
  ) {
    return redirect(
      path.to.operations,
      await flash(request, {
        ...error(jobOperation.error, "Failed to fetch job operation"),
        flash: "error"
      })
    );
  }

  // An Inspection operation completes only through its inspection: the
  // traveler's Complete QR opens the inspection view and posts nothing.
  if (jobOperation.data.operationType === "Inspection") {
    return redirect(path.to.inspection(operationId));
  }

  const abilityRefusal = await abilityBlockRefusal(serviceRole, {
    operationId,
    employeeId: userId,
    companyId
  });
  if (abilityRefusal) {
    return redirect(
      path.to.operation(operationId),
      await flash(request, error(null, abilityRefusal))
    );
  }

  const completeAll = jobOperation.data?.completeAllOnScan ?? false;

  const jobMakeMethod = await serviceRole
    .from("jobMakeMethod")
    .select("*")
    .eq("id", jobOperation.data.jobMakeMethodId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (jobMakeMethod.error || !jobMakeMethod.data) {
    return redirect(
      path.to.operations,
      await flash(
        request,
        error(jobMakeMethod.error, "Failed to fetch job make method")
      )
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

  // The unit this scan completes: the one the screen held, the one left, or
  // the next in order on the first operation. A later operation never takes
  // the server's own pick: it asks for the unit.
  const work =
    isTrackedEntity && quantityToComplete > 0
      ? await resolveWorkUnit({
          client: serviceRole,
          companyId,
          operationId,
          requestedUnitId,
          mode: "advance"
        })
      : null;
  if (work?.kind === "refuse") {
    return redirect(
      requestedUnitId
        ? `${path.to.operation(operationId)}?trackedEntityId=${requestedUnitId}`
        : path.to.operation(operationId),
      await flash(request, error(null, work.message))
    );
  }
  const trackedEntityId =
    work?.kind === "unit"
      ? work.unitId
      : work?.kind === "none"
        ? (work.lotId ?? null)
        : null;
  const isFirstOperation = work?.kind === "unit" && work.isFirstOperation;

  // Business-rule pre-flight on operationFinish. Only fires when this scan
  // actually closes the operation (`willBeFinished`); transient quantity
  // events don't trigger finish rules.
  if (willBeFinished && jobOperation.data.workCenterId) {
    const acknowledged = url.searchParams.get("acknowledged") === "true";
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
      return redirect(
        path.to.operation(operationId),
        await flash(
          request,
          error(
            ruleEval.violations[0]?.message ?? "Rule violation",
            "Cannot finish operation"
          )
        )
      );
    }
  }

  if (quantityToComplete > 0) {
    if (isTrackedEntity) {
      const shortfall = await getRequiredScanShortfall(serviceRole, {
        companyId,
        jobOperationId: jobOperation.data.id,
        trackedEntityId: trackedEntityId ?? undefined,
        parentIsSerial: jobMakeMethod.data.requiresSerialTracking,
        quantity: quantityToComplete
      });
      if (shortfall.message) {
        return redirect(
          trackedEntityId
            ? `${path.to.operation(operationId)}?trackedEntityId=${trackedEntityId}`
            : path.to.operation(operationId),
          await flash(request, error(null, shortfall.message))
        );
      }

      if (jobMakeMethod.data.requiresSerialTracking && trackedEntityId) {
        const response = await deps.post(
          "issue",
          { companyId, userId },
          {
            type: "jobOperationSerialComplete",
            quantity: 1,
            jobOperationId: jobOperation.data.id,
            trackedEntityId,
            notes: "Generated by QR code"
          }
        );

        if (response.error) {
          return redirect(
            path.to.operation(operationId),
            await flash(request, {
              ...error(
                response.error,
                response.error.message || "Failed to complete job operation"
              ),
              flash: "error"
            })
          );
        }

        const newTrackedEntityId = response.data?.newTrackedEntityId as
          | string
          | undefined;

        // Auto-print the unit label at the first or last operation (autoPrintOperationLabel decides).
        // Print the unit just completed, not the new reserved one.
        await autoPrintOperationLabel({
          serviceRole,
          trackedEntityId,
          jobOperationId: jobOperation.data.id,
          jobMakeMethodId: jobOperation.data.jobMakeMethodId,
          workCenterId: jobOperation.data.workCenterId ?? undefined,
          companyId,
          userId
        });

        if (newTrackedEntityId && isFirstOperation) {
          return redirect(
            `${path.to.operation(
              operationId
            )}?trackedEntityId=${newTrackedEntityId}`
          );
        }

        if (willBeFinished) {
          const finishOperation = await finishJobOperation(serviceRole, {
            jobOperationId: jobOperation.data.id,
            userId,
            companyId
          });

          if (finishOperation.error) {
            return redirect(
              path.to.operation(operationId),
              await flash(
                request,
                error(finishOperation.error, "Failed to finish operation")
              )
            );
          }

          return redirect(
            path.to.operations,
            await flash(request, {
              ...success("Operation finished successfully"),
              flash: "success"
            })
          );
        }

        // Later operation: stay on the unit just completed. The view sees it
        // complete and asks for the next unit (scan or select).
        if (!isFirstOperation) {
          return redirect(
            `${path.to.operation(operationId)}?trackedEntityId=${trackedEntityId}`,
            await flash(request, {
              ...success("Completed"),
              flash: "success"
            })
          );
        }

        // Pre-split flow: the issue function did not spawn a new entity (all
        // units already exist), so advance to the next incomplete serial unit
        // for this operation. When none remain, fall through to the shared
        // "operation complete" redirect below.
        const remainingTrackedEntities = await getTrackedEntitiesForOperation(
          serviceRole,
          {
            operationId,
            jobMakeMethodId: jobOperation.data.jobMakeMethodId,
            companyId
          }
        );
        const nextTrackedEntity = (remainingTrackedEntities.data ?? []).find(
          (entity) => isSerialEntityIncompleteForOperation(entity, operationId)
        );
        if (nextTrackedEntity) {
          return redirect(
            `${path.to.operation(
              operationId
            )}?trackedEntityId=${nextTrackedEntity.id}`
          );
        }
      } else if (jobMakeMethod.data.requiresBatchTracking) {
        const response = await deps.post(
          "issue",
          { companyId, userId },
          {
            type: "jobOperationBatchComplete",
            quantity: quantityToComplete,
            jobOperationId: jobOperation.data.id,
            trackedEntityId: trackedEntityId!,
            notes: "Generated by QR code"
          }
        );

        if (response.error) {
          return redirect(
            path.to.operation(operationId),
            await flash(request, {
              ...error(
                response.error,
                response.error.message || "Failed to complete job operation"
              ),
              flash: "error"
            })
          );
        }

        // Auto-print the unit label at the first or last operation (autoPrintOperationLabel decides)
        if (trackedEntityId) {
          await autoPrintOperationLabel({
            serviceRole,
            trackedEntityId,
            jobOperationId: jobOperation.data.id,
            jobMakeMethodId: jobOperation.data.jobMakeMethodId,
            workCenterId: jobOperation.data.workCenterId ?? undefined,
            companyId,
            userId
          });
        }
      }
    } else {
      const shortfall = await getRequiredScanShortfall(serviceRole, {
        companyId,
        jobOperationId: jobOperation.data.id,
        parentIsSerial: false,
        quantity: quantityToComplete
      });
      if (shortfall.message) {
        return redirect(
          path.to.operation(operationId),
          await flash(request, error(null, shortfall.message))
        );
      }

      const check = await checkStrictBackflush({
        jobOperationId: operationId,
        quantity: quantityToComplete,
        companyId,
        userId
      });

      if (check.error) {
        return redirect(
          path.to.operation(operationId),
          await flash(request, {
            ...error(check.error, check.message!),
            flash: "error"
          })
        );
      }

      const insertProduction = await insertProductionQuantity(
        serviceRole,
        {
          quantity: quantityToComplete,
          jobOperationId: jobOperation.data.id,
          notes: "Generated by QR code",
          companyId,
          createdBy: userId
        },
        "mes_qr"
      );

      if (insertProduction.error) {
        return redirect(
          path.to.operation(operationId),
          await flash(request, {
            ...error(
              insertProduction.error,
              "Failed to record production quantity"
            ),
            flash: "error"
          })
        );
      }

      const issued = await deps.post(
        "issue",
        { companyId, userId },
        {
          id: operationId,
          type: "jobOperation",
          quantity: quantityToComplete
        }
      );

      if (issued.error) {
        return redirect(
          path.to.operation(operationId),
          await flash(request, {
            ...error(
              issued.error,
              `Units completed, but ${issued.error.message || "failed to issue materials"}`
            ),
            flash: "error"
          })
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
      return redirect(
        path.to.operation(operationId),
        await flash(request, {
          ...error(finishOperation.error, "Failed to finish operation"),
          flash: "error"
        })
      );
    }

    return redirect(
      path.to.operations,
      await flash(request, {
        ...success("Operation finished successfully"),
        flash: "success"
      })
    );
  }

  return redirect(
    path.to.operation(operationId),
    await flash(request, {
      ...success("Successfully completed part"),
      flash: "success"
    })
  );
}
