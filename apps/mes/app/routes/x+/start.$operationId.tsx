import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLocalTimeZone, now } from "@internationalized/date";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import {
  getProductionEventsForJobOperation,
  getTrackedEntitiesByMakeMethodId,
  startProductionEvent,
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
  const [jobOperation, productionEvents] = await Promise.all([
    serviceRole
      .from("jobOperation")
      .select("*")
      .eq("id", operationId)
      .maybeSingle(),
    getProductionEventsForJobOperation(serviceRole, {
      operationId,
      userId,
    }),
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

  const hasActiveEvents =
    Array.isArray(productionEvents.data) && productionEvents.data.length > 0;

  const startEvent = await startProductionEvent(
    serviceRole,
    {
      type,
      jobOperationId: operationId,
      workCenterId: jobOperation.data.workCenterId!,
      startTime: now(getLocalTimeZone()).toAbsoluteString(),
      employeeId: userId,
      companyId,
      createdBy: userId,
    },
    trackedEntityId || undefined
  );

  if (startEvent.error) {
    throw redirect(
      path.to.operations,
      await flash(request, error(startEvent.error, "Failed to start event"))
    );
  }

  if (hasActiveEvents === false) {
    const serviceRole = await getCarbonServiceRole();
    const issue = await serviceRole.functions.invoke("issue", {
      body: {
        id: operationId,
        type: "jobOperation",
        companyId,
        userId,
      },
    });

    if (issue.error) {
      throw redirect(
        path.to.operation(operationId),
        await flash(request, error(issue.error, "Failed to issue materials"))
      );
    }
  }

  throw redirect(path.to.operation(operationId));
}
