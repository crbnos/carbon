import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  clearCrewAbsence,
  copyCrewBoard,
  copyCrewBoardValidator,
  crewAbsenceValidator,
  crewAssignmentValidator,
  deleteCrewAssignment,
  notifyScheduleInputsChanged,
  setCrewAbsence,
  updateCrewAssignmentNote,
  upsertCrewAssignment
} from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";

/**
 * Notify the replan pipeline once per station the person is crewed at on the
 * date; when they're crewed nowhere, fall back to the unscoped crew kind
 * (gated-process scoping in the mark function).
 */
async function notifyForEmployeeDate(
  client: Awaited<ReturnType<typeof requirePermissions>>["client"],
  companyId: string,
  employeeId: string,
  date: string,
  reason: string
) {
  const assignments = await client
    .from("crewAssignment")
    .select("workCenterId")
    .eq("companyId", companyId)
    .eq("employeeId", employeeId)
    .eq("date", date);
  const workCenterIds = [
    ...new Set((assignments.data ?? []).map((row) => row.workCenterId))
  ];
  if (workCenterIds.length === 0) {
    await notifyScheduleInputsChanged(companyId, "crew", reason);
    return;
  }
  for (const workCenterId of workCenterIds) {
    await notifyScheduleInputsChanged(companyId, "crew", reason, workCenterId);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "assign") {
    const validation = await validator(crewAssignmentValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { workCenterId, employeeId, locationId, date, shiftId, note } =
      validation.data;

    try {
      await upsertCrewAssignment(getDatabaseClient(), {
        companyId,
        locationId,
        workCenterId,
        employeeId,
        date,
        shiftId: shiftId || null,
        note,
        createdBy: userId
      });
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to assign crew member"))
      );
    }

    await notifyScheduleInputsChanged(
      companyId,
      "crew",
      "Crew assignment changed",
      workCenterId
    );
    return data({ success: true });
  }

  if (intent === "unassign") {
    const id = String(formData.get("id") ?? "");
    if (!id) {
      return data(
        { success: false },
        await flash(request, error(null, "Missing assignment id"))
      );
    }
    const removed = await deleteCrewAssignment(client, id, companyId);
    if (removed.error) {
      return data(
        { success: false },
        await flash(
          request,
          error(removed.error, "Failed to remove crew member")
        )
      );
    }
    await notifyScheduleInputsChanged(
      companyId,
      "crew",
      "Crew assignment removed",
      removed.data.workCenterId
    );
    return data({ success: true });
  }

  if (intent === "absent") {
    const validation = await validator(crewAbsenceValidator).validate(formData);
    if (validation.error) return validationError(validation.error);
    const { employeeId, date, shiftId, note } = validation.data;

    const absence = await setCrewAbsence(client, {
      companyId,
      employeeId,
      date,
      shiftId: shiftId || null,
      note,
      createdBy: userId
    });
    if (absence.error) {
      return data(
        { success: false },
        await flash(request, error(absence.error, "Failed to mark absent"))
      );
    }
    await notifyForEmployeeDate(
      client,
      companyId,
      employeeId,
      date,
      "Crew member marked absent"
    );
    return data({ success: true });
  }

  if (intent === "clear-absence") {
    const id = String(formData.get("id") ?? "");
    if (!id) {
      return data(
        { success: false },
        await flash(request, error(null, "Missing absence id"))
      );
    }
    const cleared = await clearCrewAbsence(client, id, companyId);
    if (cleared.error) {
      return data(
        { success: false },
        await flash(request, error(cleared.error, "Failed to clear absence"))
      );
    }
    const url = new URL(request.url);
    const date =
      String(formData.get("date") ?? "") ||
      url.searchParams.get("date") ||
      new Date().toISOString().slice(0, 10);
    await notifyForEmployeeDate(
      client,
      companyId,
      cleared.data.employeeId,
      date,
      "Crew absence cleared"
    );
    return data({ success: true });
  }

  if (intent === "note") {
    const id = String(formData.get("id") ?? "");
    const note = String(formData.get("note") ?? "");
    if (!id) {
      return data(
        { success: false },
        await flash(request, error(null, "Missing assignment id"))
      );
    }
    const updated = await updateCrewAssignmentNote(client, {
      id,
      companyId,
      note: note || null,
      updatedBy: userId
    });
    if (updated.error) {
      return data(
        { success: false },
        await flash(request, error(updated.error, "Failed to update note"))
      );
    }
    return data({ success: true });
  }

  if (intent === "copy") {
    const validation = await validator(copyCrewBoardValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { locationId, fromDate, toDate, shiftId } = validation.data;

    try {
      const result = await copyCrewBoard(getDatabaseClient(), {
        companyId,
        locationId,
        fromDate,
        toDate,
        shiftId: shiftId || null,
        createdBy: userId
      });
      await notifyScheduleInputsChanged(
        companyId,
        "crew",
        "Crew board copied from previous day"
      );
      return data(
        { success: true, ...result },
        await flash(request, success(`Copied ${result.copied} assignments`))
      );
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to copy crew board"))
      );
    }
  }

  return data(
    { success: false },
    await flash(request, error(null, "Unknown intent"))
  );
}
