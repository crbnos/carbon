import { requirePermissions } from "@carbon/auth/auth.server";
import { getLocalTimeZone, now } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { endProductionEvents } from "~/services/operations.service";
import {
  clockOut,
  endOpenBreakOnLogin,
  getOpenClockEntry,
  getOpenTimeCardBreak
} from "~/services/people.service";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const formData = await request.formData();
  const timezone = formData.get("timezone") as string | null;
  const endTime = now(timezone ?? getLocalTimeZone()).toAbsoluteString();

  const updates = await endProductionEvents(client, {
    companyId,
    employeeId: userId,
    endTime
  });

  if (updates.error) {
    return data(
      { success: false, message: updates.error.message },
      { status: 500 }
    );
  }

  const [openEntry, openBreak] = await Promise.all([
    getOpenClockEntry(client, userId, companyId),
    getOpenTimeCardBreak(client, userId, companyId)
  ]);

  if (openBreak.error) {
    return data(
      { success: false, message: openBreak.error.message },
      { status: 500 }
    );
  }

  if (openEntry.error) {
    return data(
      { success: false, message: openEntry.error.message },
      { status: 500 }
    );
  }

  if (openBreak.data) {
    const endedBreak = await endOpenBreakOnLogin(client, {
      employeeId: userId,
      companyId,
      endedBy: userId,
      endTime
    });

    if (endedBreak.error) {
      return data(
        { success: false, message: endedBreak.error.message },
        { status: 500 }
      );
    }
  }

  if (openEntry.data) {
    const clockOutResult = await clockOut(client, {
      employeeId: userId,
      companyId,
      updatedBy: userId,
      clockOut: endTime,
      note: "Shift ended by employee"
    });

    if (clockOutResult.error) {
      return data(
        { success: false, message: clockOutResult.error.message },
        { status: 500 }
      );
    }
  }

  return { success: true, message: "Successfully ended shift" };
}
