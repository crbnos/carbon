import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { notifyScheduleInputsChanged } from "~/modules/production";
import {
  isMaintenanceDispatchLocked,
  updateMaintenanceDispatch
} from "~/modules/resources";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

// Field changes that can move a work center's downtime window.
const SCHEDULE_AFFECTING_FIELDS = new Set([
  "status",
  "workCenterId",
  "plannedStartTime",
  "plannedEndTime",
  "actualStartTime",
  "actualEndTime"
]);

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null)
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  // Per-ID locked check (also carries the offline flag + work center so a
  // downtime-affecting edit can stamp the schedule below).
  const dispatches = await client
    .from("maintenanceDispatch")
    .select("id, status, takesWorkCenterOffline, workCenterId")
    .in("id", ids as string[]);

  const lockedError = requireUnlockedBulk({
    statuses: (dispatches.data ?? []).map((d) => d.status),
    checkFn: isMaintenanceDispatchLocked,
    message: "Cannot modify a locked dispatch. Reopen it first."
  });
  if (lockedError) return lockedError;

  const updateData: Record<string, unknown> = {
    updatedBy: userId,
    updatedAt: new Date().toISOString()
  };

  switch (field) {
    case "priority":
    case "severity":
    case "source":
    case "status":
    case "oeeImpact":
    case "suspectedFailureModeId":
    case "actualFailureModeId":
    case "procedureId":
    case "workCenterId":
      updateData[field] = value || null;
      break;
    case "plannedStartTime":
    case "plannedEndTime":
    case "actualStartTime":
    case "actualEndTime":
      updateData[field] = value ? new Date(value).toISOString() : null;
      break;
    default:
      return {
        error: { message: `Invalid field: ${field}` },
        data: null
      };
  }

  // Handle special status updates with timestamps
  if (field === "status") {
    if (value === "In Progress") {
      updateData.actualStartTime = new Date().toISOString();
    } else if (value === "Completed") {
      updateData.actualEndTime = new Date().toISOString();
    }
  }

  const results = await Promise.all(
    ids.map(async (id) => {
      return await updateMaintenanceDispatch(client, {
        id: id as string,
        ...updateData
      } as Parameters<typeof updateMaintenanceDispatch>[1]);
    })
  );

  // Check if any updates failed
  const errors = results.filter((result) => result.error);
  if (errors.length > 0) {
    return {
      error: { message: "Failed to update maintenance dispatch(es)" },
      data: null
    };
  }

  // A downtime-affecting change on an offline dispatch (status, work center, or
  // timing) moves the work center's outage window — stamp it so the wave
  // regenerates. Completing/cancelling restores the hours the same way.
  if (SCHEDULE_AFFECTING_FIELDS.has(field)) {
    const affectedWorkCenterIds = new Set<string>();
    for (const d of dispatches.data ?? []) {
      if (!d.takesWorkCenterOffline) continue;
      if (d.workCenterId) affectedWorkCenterIds.add(d.workCenterId);
    }
    for (const workCenterId of affectedWorkCenterIds) {
      await notifyScheduleInputsChanged(
        companyId,
        "work-center",
        "Machine downtime changed",
        workCenterId
      );
    }
  }

  return { data: results.map((result) => result.data) };
}
