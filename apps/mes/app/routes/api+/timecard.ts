import { requirePermissions } from "@carbon/auth/auth.server";
import { destroyAuthSession } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { endProductionEvents } from "~/services/operations.service";
import { clockIn, clockOut, startBreak } from "~/services/people.service";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});
  throw redirect("/login");
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "clockIn") {
    const result = await clockIn(client, {
      employeeId: userId,
      companyId,
      createdBy: userId
    });
    return { success: !result.error, error: result.error?.message };
  }

  if (intent === "clockOut") {
    const note = formData.get("note") as string | null;
    const result = await clockOut(client, {
      employeeId: userId,
      companyId,
      updatedBy: userId,
      note: note ?? undefined
    });
    return { success: !result.error, error: result.error?.message };
  }

  if (intent === "startBreak") {
    const breakType =
      (formData.get("breakType") as "Break" | "Lunch" | null) ?? "Break";
    const note = formData.get("note") as string | null;
    const startTime = new Date().toISOString();

    const breakResult = await startBreak(client, {
      employeeId: userId,
      companyId,
      breakType,
      startedBy: userId,
      startTime,
      note: note ?? undefined
    });

    if (breakResult.error) {
      return { success: false, error: breakResult.error.message };
    }

    await endProductionEvents(client, {
      companyId,
      employeeId: userId,
      endTime: startTime
    });

    return destroyAuthSession(request);
  }

  return { success: false, error: "Unknown intent" };
}
