import { requirePermissions } from "@carbon/auth/auth.server";
import { destroyAuthSession } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { endProductionEvents } from "~/services/operations.service";
import { startBreak } from "~/services/people.service";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});
  throw redirect(path.to.timeCardPage);
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
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
    throw redirect(path.to.timeCardPage);
  }

  await endProductionEvents(client, {
    companyId,
    employeeId: userId,
    endTime: startTime
  });

  return destroyAuthSession(request);
}
