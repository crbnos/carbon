import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  endMaintenanceEvent,
  startMaintenanceEvent,
  updateMaintenanceDispatchStatus
} from "~/services/maintenance.service";
import { notifyScheduleInputsChanged } from "~/services/operations.service";
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
  const currentTime = datetime.timestamp();

  // A dispatch that takes its work center offline moves the schedule's downtime
  // window when it starts (down begins) or completes (down ends) — stamp the
  // work center so the wave regenerates its location.
  const stampScheduleIfOffline = async () => {
    const { data: dispatch } = await serviceRole
      .from("maintenanceDispatch")
      .select("takesWorkCenterOffline, workCenterId")
      .eq("id", dispatchId)
      .single();
    if (dispatch?.takesWorkCenterOffline && dispatch.workCenterId) {
      await notifyScheduleInputsChanged(
        companyId,
        "work-center",
        "Machine downtime changed",
        dispatch.workCenterId
      );
    }
  };

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

    await stampScheduleIfOffline();

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

    await stampScheduleIfOffline();

    throw redirect(
      path.to.maintenance,
      await flash(request, success("Maintenance completed"))
    );
  }

  return data({});
}
