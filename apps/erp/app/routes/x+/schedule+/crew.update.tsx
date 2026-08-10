import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assignCrewWeek,
  clearCrewAbsence,
  copyCrewBoard,
  copyCrewBoardValidator,
  copyCrewWeek,
  copyCrewWeekValidator,
  crewAbsenceRangeValidator,
  crewAbsenceValidator,
  crewAssignmentValidator,
  crewDayValidator,
  crewHoursValidator,
  crewMoveValidator,
  crewOvertimeBulkValidator,
  crewWeekAssignValidator,
  crewWeekMoveValidator,
  crewWeekUnassignValidator,
  deleteCrewAssignment,
  moveCrewAssignment,
  moveCrewWeek,
  notifyScheduleInputsChanged,
  setCrewAbsence,
  setCrewAbsenceRange,
  setCrewAssignmentHours,
  setCrewDay,
  setCrewOvertimeBulk,
  unassignCrewWeek,
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
    const { workCenterId, employeeId, locationId, date, shiftId, note, hours } =
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
        hours,
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

  if (intent === "move") {
    const validation = await validator(crewMoveValidator).validate(formData);
    if (validation.error) return validationError(validation.error);
    const { id, workCenterId } = validation.data;

    try {
      const result = await moveCrewAssignment(getDatabaseClient(), {
        id,
        companyId,
        workCenterId
      });
      await notifyScheduleInputsChanged(
        companyId,
        "crew",
        "Crew assignment moved",
        result.workCenterId
      );
      return { success: true };
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to move assignment"))
      );
    }
  }

  if (intent === "day-hours") {
    const validation = await validator(crewDayValidator).validate(formData);
    if (validation.error) return validationError(validation.error);
    const { employeeId, locationId, date, shiftId, note, overtimeHours, rows } =
      validation.data;

    try {
      await setCrewDay(getDatabaseClient(), {
        companyId,
        locationId,
        employeeId,
        date,
        shiftId: shiftId || null,
        note: note || null,
        overtimeHours,
        rows,
        createdBy: userId
      });
      await notifyForEmployeeDate(
        client,
        companyId,
        employeeId,
        date,
        "Crew day hours changed"
      );
      return data({ success: true });
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to save working hours"))
      );
    }
  }

  if (intent === "hours") {
    const validation = await validator(crewHoursValidator).validate(formData);
    if (validation.error) return validationError(validation.error);
    const { id, hours } = validation.data;

    const result = await setCrewAssignmentHours(client, companyId, {
      id,
      hours: hours ?? null,
      updatedBy: userId
    });
    if (result.error) {
      return data(
        { success: false },
        await flash(request, error(result.error, "Failed to set hours"))
      );
    }
    await notifyScheduleInputsChanged(
      companyId,
      "crew",
      "Crew assignment hours changed",
      result.data.workCenterId
    );
    return { success: true };
  }

  if (intent === "overtime-bulk") {
    const validation = await validator(crewOvertimeBulkValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { locationId, date, toDate, hours, departmentId, shiftId } =
      validation.data;

    try {
      const rows = await setCrewOvertimeBulk(getDatabaseClient(), {
        companyId,
        locationId,
        date,
        toDate: toDate || null,
        hours,
        shiftId: shiftId || null,
        departmentId: departmentId || null,
        updatedBy: userId
      });
      const workCenterIds = [...new Set(rows.map((row) => row.workCenterId))];
      for (const workCenterId of workCenterIds) {
        await notifyScheduleInputsChanged(
          companyId,
          "crew",
          "Crew overtime changed",
          workCenterId
        );
      }
      return data(
        { success: true, updated: rows.length },
        await flash(
          request,
          success(`Overtime set for ${rows.length} assignments`)
        )
      );
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to set overtime"))
      );
    }
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

  if (intent === "assign-week") {
    const validation = await validator(crewWeekAssignValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { locationId, employeeId, workCenterId, weekStart, shiftId } =
      validation.data;

    try {
      await assignCrewWeek(getDatabaseClient(), {
        companyId,
        locationId,
        employeeId,
        workCenterId,
        weekStart,
        shiftId: shiftId || null,
        createdBy: userId
      });
      await notifyScheduleInputsChanged(
        companyId,
        "crew",
        "Crew week assignment",
        workCenterId
      );
      return { success: true };
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to assign week"))
      );
    }
  }

  if (intent === "unassign-week") {
    const validation = await validator(crewWeekUnassignValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { employeeId, workCenterId, weekStart, shiftId } = validation.data;

    try {
      await unassignCrewWeek(getDatabaseClient(), {
        companyId,
        employeeId,
        workCenterId,
        weekStart,
        shiftId: shiftId || null
      });
      await notifyScheduleInputsChanged(
        companyId,
        "crew",
        "Crew week unassignment",
        workCenterId
      );
      return { success: true };
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to unassign week"))
      );
    }
  }

  if (intent === "move-week") {
    const validation = await validator(crewWeekMoveValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { employeeId, fromWorkCenterId, workCenterId, weekStart, shiftId } =
      validation.data;

    try {
      await moveCrewWeek(getDatabaseClient(), {
        companyId,
        employeeId,
        fromWorkCenterId,
        workCenterId,
        weekStart,
        shiftId: shiftId || null
      });
      await notifyScheduleInputsChanged(
        companyId,
        "crew",
        "Crew week move",
        workCenterId
      );
      return { success: true };
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to move week"))
      );
    }
  }

  if (intent === "copy-week") {
    const validation = await validator(copyCrewWeekValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { locationId, fromWeekStart, toWeekStart, shiftId } = validation.data;

    try {
      const result = await copyCrewWeek(getDatabaseClient(), {
        companyId,
        locationId,
        fromWeekStart,
        toWeekStart,
        shiftId: shiftId || null,
        createdBy: userId
      });
      await notifyScheduleInputsChanged(
        companyId,
        "crew",
        "Crew week copied from previous week"
      );
      return data(
        { success: true, ...result },
        await flash(request, success(`Copied ${result.copied} assignments`))
      );
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to copy crew week"))
      );
    }
  }

  if (intent === "absent-range") {
    const validation = await validator(crewAbsenceRangeValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { employeeId, fromDate, toDate, shiftId, note } = validation.data;

    try {
      const result = await setCrewAbsenceRange(getDatabaseClient(), {
        companyId,
        employeeId,
        fromDate,
        toDate,
        shiftId: shiftId || null,
        note,
        createdBy: userId
      });
      await notifyScheduleInputsChanged(
        companyId,
        "crew",
        "Crew absence range set"
      );
      return data(
        { success: true, ...result },
        await flash(
          request,
          success(`Marked absent for ${result.created} day(s)`)
        )
      );
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to set absence range"))
      );
    }
  }

  return data(
    { success: false },
    await flash(request, error(null, "Unknown intent"))
  );
}
