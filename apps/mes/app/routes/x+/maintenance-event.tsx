import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
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

const logger = getLogger("mes", "maintenance-event");

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

  // Every write below is service-role and the ids come from the form, so the
  // dispatch (and, on Start, the work center) must be this company's.
  const [ownedDispatch, ownedWorkCenter] = await Promise.all([
    serviceRole
      .from("maintenanceDispatch")
      .select("id")
      .eq("id", dispatchId)
      .eq("companyId", companyId)
      .maybeSingle(),
    action === "Start" && workCenterId
      ? serviceRole
          .from("workCenter")
          .select("id")
          .eq("id", workCenterId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null
  ]);
  if (!ownedDispatch.data || (ownedWorkCenter && !ownedWorkCenter.data)) {
    logger.warn("Dispatch or work center not found in company", {
      companyId,
      dispatchId,
      workCenterId,
      error: ownedDispatch.error ?? ownedWorkCenter?.error
    });
    return data(
      {},
      await flash(request, error(null, "Maintenance dispatch not found"))
    );
  }

  // A dispatch that takes its work center offline moves the schedule's downtime
  // window when it starts (down begins) or completes (down ends) — stamp the
  // work center so the wave regenerates its location.
  const stampScheduleIfOffline = async () => {
    const { data: dispatch } = await serviceRole
      .from("maintenanceDispatch")
      .select("takesWorkCenterOffline, workCenterId")
      .eq("id", dispatchId)
      .eq("companyId", companyId)
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
      updatedBy: userId,
      companyId
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
      updatedBy: userId,
      companyId
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
        updatedBy: userId,
        companyId
      });
    }

    // Update dispatch status to Completed
    const updateStatus = await updateMaintenanceDispatchStatus(serviceRole, {
      dispatchId,
      status: "Completed",
      actualEndTime: currentTime,
      completedAt: currentTime,
      updatedBy: userId,
      companyId
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
