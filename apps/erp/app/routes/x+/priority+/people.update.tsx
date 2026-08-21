import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assignPeopleWeek,
  clearPeopleAbsence,
  copyPeopleBoard,
  copyPeopleBoardValidator,
  copyPeopleWeek,
  copyPeopleWeekValidator,
  deletePeopleAssignment,
  movePeopleAssignment,
  movePeopleWeek,
  notifyScheduleInputsChanged,
  peopleAbsenceRangeValidator,
  peopleAbsenceValidator,
  peopleAssignmentValidator,
  peopleDayValidator,
  peopleHoursValidator,
  peopleMoveValidator,
  peopleOvertimeBulkValidator,
  peopleWeekAssignValidator,
  peopleWeekMoveValidator,
  peopleWeekUnassignValidator,
  setPeopleAbsence,
  setPeopleAbsenceRange,
  setPeopleAssignmentHours,
  setPeopleDay,
  setPeopleOvertimeBulk,
  unassignPeopleWeek,
  upsertPeopleAssignment
} from "~/modules/production";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";

/**
 * Notify the replan pipeline once per station the person is assigned at on the
 * date; when they're assigned nowhere, fall back to the unscoped people kind
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
    .from("peopleAssignment")
    .select("workCenterId")
    .eq("companyId", companyId)
    .eq("employeeId", employeeId)
    .eq("date", date);
  const workCenterIds = [
    ...new Set((assignments.data ?? []).map((row) => row.workCenterId))
  ];
  if (workCenterIds.length === 0) {
    await notifyScheduleInputsChanged(companyId, "people", reason);
    return;
  }
  for (const workCenterId of workCenterIds) {
    await notifyScheduleInputsChanged(
      companyId,
      "people",
      reason,
      workCenterId
    );
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
    const validation = await validator(peopleAssignmentValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { workCenterId, employeeId, locationId, date, shiftId, note, hours } =
      validation.data;

    try {
      await upsertPeopleAssignment(getDatabaseClient(), {
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
        await flash(request, error(err, "Failed to assign people member"))
      );
    }

    await notifyScheduleInputsChanged(
      companyId,
      "people",
      "People assignment changed",
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
    const removed = await deletePeopleAssignment(client, id, companyId);
    if (removed.error) {
      return data(
        { success: false },
        await flash(
          request,
          error(removed.error, "Failed to remove people member")
        )
      );
    }
    await notifyScheduleInputsChanged(
      companyId,
      "people",
      "People assignment removed",
      removed.data.workCenterId
    );
    return data({ success: true });
  }

  if (intent === "absent") {
    const validation = await validator(peopleAbsenceValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { employeeId, date, shiftId, note } = validation.data;

    const absence = await setPeopleAbsence(client, {
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
      "People member marked absent"
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
    const cleared = await clearPeopleAbsence(client, id, companyId);
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
      datetime.today(await getCompanyTimeZone(client, companyId)).toString();
    await notifyForEmployeeDate(
      client,
      companyId,
      cleared.data.employeeId,
      date,
      "People absence cleared"
    );
    return data({ success: true });
  }

  if (intent === "move") {
    const validation = await validator(peopleMoveValidator).validate(formData);
    if (validation.error) return validationError(validation.error);
    const { id, workCenterId } = validation.data;

    try {
      const result = await movePeopleAssignment(getDatabaseClient(), {
        id,
        companyId,
        workCenterId
      });
      // Reschedule BOTH stations: the destination gains the person and the
      // source loses them, so ops on the source work center must re-plan too
      // (otherwise the source keeps showing a stale booking for the moved
      // person). Dedup a same-station move.
      const affectedWorkCenterIds = [
        ...new Set(
          [result.workCenterId, result.previousWorkCenterId].filter(
            (id): id is string => Boolean(id)
          )
        )
      ];
      for (const affectedWorkCenterId of affectedWorkCenterIds) {
        await notifyScheduleInputsChanged(
          companyId,
          "people",
          "People assignment moved",
          affectedWorkCenterId
        );
      }
      return { success: true };
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to move assignment"))
      );
    }
  }

  if (intent === "day-hours") {
    const validation = await validator(peopleDayValidator).validate(formData);
    if (validation.error) return validationError(validation.error);
    const { employeeId, locationId, date, shiftId, note, overtimeHours, rows } =
      validation.data;

    try {
      await setPeopleDay(getDatabaseClient(), {
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
        "People day hours changed"
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
    const validation = await validator(peopleHoursValidator).validate(formData);
    if (validation.error) return validationError(validation.error);
    const { id, hours } = validation.data;

    const result = await setPeopleAssignmentHours(client, companyId, {
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
      "people",
      "People assignment hours changed",
      result.data.workCenterId
    );
    return { success: true };
  }

  if (intent === "overtime-bulk") {
    const validation = await validator(peopleOvertimeBulkValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { locationId, date, toDate, hours, departmentId, shiftId } =
      validation.data;

    try {
      const rows = await setPeopleOvertimeBulk(getDatabaseClient(), {
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
          "people",
          "People overtime changed",
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
    const validation = await validator(copyPeopleBoardValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { locationId, fromDate, toDate, shiftId } = validation.data;

    try {
      const result = await copyPeopleBoard(getDatabaseClient(), {
        companyId,
        locationId,
        fromDate,
        toDate,
        shiftId: shiftId || null,
        createdBy: userId
      });
      await notifyScheduleInputsChanged(
        companyId,
        "people",
        "People board copied from previous day"
      );
      return data(
        { success: true, ...result },
        await flash(request, success(`Copied ${result.copied} assignments`))
      );
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to copy people board"))
      );
    }
  }

  if (intent === "assign-week") {
    const validation = await validator(peopleWeekAssignValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { locationId, employeeId, workCenterId, weekStart, shiftId } =
      validation.data;

    try {
      await assignPeopleWeek(getDatabaseClient(), {
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
        "people",
        "People week assignment",
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
    const validation = await validator(peopleWeekUnassignValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { employeeId, workCenterId, weekStart, shiftId } = validation.data;

    try {
      await unassignPeopleWeek(getDatabaseClient(), {
        companyId,
        employeeId,
        workCenterId,
        weekStart,
        shiftId: shiftId || null
      });
      await notifyScheduleInputsChanged(
        companyId,
        "people",
        "People week unassignment",
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
    const validation = await validator(peopleWeekMoveValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { employeeId, fromWorkCenterId, workCenterId, weekStart, shiftId } =
      validation.data;

    try {
      await movePeopleWeek(getDatabaseClient(), {
        companyId,
        employeeId,
        fromWorkCenterId,
        workCenterId,
        weekStart,
        shiftId: shiftId || null
      });
      await notifyScheduleInputsChanged(
        companyId,
        "people",
        "People week move",
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
    const validation = await validator(copyPeopleWeekValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { locationId, fromWeekStart, toWeekStart, shiftId } = validation.data;

    try {
      const result = await copyPeopleWeek(getDatabaseClient(), {
        companyId,
        locationId,
        fromWeekStart,
        toWeekStart,
        shiftId: shiftId || null,
        createdBy: userId
      });
      await notifyScheduleInputsChanged(
        companyId,
        "people",
        "People week copied from previous week"
      );
      return data(
        { success: true, ...result },
        await flash(request, success(`Copied ${result.copied} assignments`))
      );
    } catch (err) {
      return data(
        { success: false },
        await flash(request, error(err, "Failed to copy people week"))
      );
    }
  }

  if (intent === "absent-range") {
    const validation = await validator(peopleAbsenceRangeValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const { employeeId, fromDate, toDate, shiftId, note } = validation.data;

    try {
      const result = await setPeopleAbsenceRange(getDatabaseClient(), {
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
        "people",
        "People absence range set"
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
