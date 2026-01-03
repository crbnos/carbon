import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLocalTimeZone, now } from "@internationalized/date";
import { type ActionFunctionArgs, data, redirect } from "react-router";
import {
  endMaintenanceEvent,
  startMaintenanceEvent,
  updateMaintenanceDispatchStatus
} from "~/services/maintenance.service";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const action = formData.get("action") as "Start" | "End" | "Complete";
  const dispatchId = formData.get("dispatchId") as string;
  const workCenterId = formData.get("workCenterId") as string;
  const eventId = formData.get("eventId") as string | undefined;

  if (!dispatchId) {
    return data({}, await flash(request, error("Dispatch ID is required")));
  }

  const serviceRole = await getCarbonServiceRole();
  const currentTime = now(getLocalTimeZone()).toAbsoluteString();

  if (action === "Start") {
    // Start a new maintenance event
    const startEvent = await startMaintenanceEvent(serviceRole, {
      maintenanceDispatchId: dispatchId,
      employeeId: userId,
      workCenterId,
      startTime: currentTime,
      companyId,
      createdBy: userId
    });

    if (startEvent.error) {
      return data(
        {},
        await flash(
          request,
          error(startEvent.error, "Failed to start maintenance event")
        )
      );
    }

    // Update dispatch status to In Progress
    await updateMaintenanceDispatchStatus(serviceRole, {
      dispatchId,
      status: "In Progress",
      actualStartTime: currentTime,
      updatedBy: userId
    });

    return data(
      { eventId: startEvent.data?.id },
      await flash(request, success("Maintenance started"))
    );
  }

  if (action === "End") {
    if (!eventId) {
      return data(
        {},
        await flash(request, error("Event ID is required to end"))
      );
    }

    const endEvent = await endMaintenanceEvent(serviceRole, {
      eventId,
      endTime: currentTime,
      updatedBy: userId
    });

    if (endEvent.error) {
      return data(
        {},
        await flash(
          request,
          error(endEvent.error, "Failed to end maintenance event")
        )
      );
    }

    return data({}, await flash(request, success("Maintenance paused")));
  }

  if (action === "Complete") {
    // End any active event first
    if (eventId) {
      await endMaintenanceEvent(serviceRole, {
        eventId,
        endTime: currentTime,
        updatedBy: userId
      });
    }

    // Update dispatch status to Completed
    const updateStatus = await updateMaintenanceDispatchStatus(serviceRole, {
      dispatchId,
      status: "Completed",
      actualEndTime: currentTime,
      completedAt: currentTime,
      updatedBy: userId
    });

    if (updateStatus.error) {
      return data(
        {},
        await flash(
          request,
          error(updateStatus.error, "Failed to complete maintenance")
        )
      );
    }

    throw redirect(
      path.to.maintenance,
      await flash(request, success("Maintenance completed"))
    );
  }

  return data({});
}
