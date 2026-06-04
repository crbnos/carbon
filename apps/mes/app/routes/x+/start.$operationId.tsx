import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  evaluateLinesForSurface,
  isBlocked
} from "@carbon/ee/storage-rules.server";
import { getLocalTimeZone, now } from "@internationalized/date";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getWorkCenterWithBlockingStatus } from "~/services/maintenance.service";
import {
  getTrackedEntitiesByMakeMethodId,
  startProductionEvent
} from "~/services/operations.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});
  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const url = new URL(request.url);
  let trackedEntityId = url.searchParams.get("trackedEntityId");

  let type = (url.searchParams.get("type") ?? "Labor") as
    | "Setup"
    | "Labor"
    | "Machine";
  if (!["Setup", "Labor", "Machine"].includes(type)) {
    type = "Labor";
  }

  const serviceRole = await getCarbonServiceRole();
  const [jobOperation] = await Promise.all([
    serviceRole
      .from("jobOperation")
      .select("*")
      .eq("id", operationId)
      .maybeSingle(),
    serviceRole
      .from("productionEvent")
      .update({
        endTime: null,
        updatedBy: userId
      })
      .eq("jobOperationId", operationId)
      .is("endTime", null)
  ]);

  if (jobOperation.error || !jobOperation.data) {
    throw redirect(
      path.to.operations,
      await flash(
        request,
        error(jobOperation.error, "Failed to fetch job operation")
      )
    );
  }

  if (jobOperation.data?.companyId !== companyId) {
    throw redirect(
      path.to.operations,
      await flash(
        request,
        error("You are not authorized to start this operation", "Unauthorized")
      )
    );
  }

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

  // Get tracked entities if jobMakeMethodId exists
  if (!trackedEntityId && jobOperation.data.jobMakeMethodId) {
    const trackedEntities = await getTrackedEntitiesByMakeMethodId(
      serviceRole,
      jobOperation.data.jobMakeMethodId
    );

    if (trackedEntities.data && trackedEntities.data.length > 0) {
      // Use the last tracked entity if available
      trackedEntityId =
        trackedEntities.data[trackedEntities.data.length - 1].id;
    }
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

  // If type is Machine, cancel all setup and labor production events for this operation
  if (type === "Machine") {
    const currentTime = now(getLocalTimeZone()).toAbsoluteString();

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

  const startEvent = await startProductionEvent(
    serviceRole,
    {
      type,
      jobOperationId: operationId,
      workCenterId: jobOperation.data.workCenterId!,
      startTime: now(getLocalTimeZone()).toAbsoluteString(),
      employeeId: userId,
      companyId,
      createdBy: userId
    },
    trackedEntityId || undefined
  );

  if (startEvent.error) {
    throw redirect(
      path.to.operations,
      await flash(request, error(startEvent.error, "Failed to start event"))
    );
  }

  throw redirect(path.to.operation(operationId));
}
