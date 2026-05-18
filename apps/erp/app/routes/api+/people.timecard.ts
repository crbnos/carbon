import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { clockIn, clockOut } from "~/modules/people";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "clockIn") {
    const result = await clockIn({
      employeeId: userId,
      companyId,
      createdBy: userId
    });
    return { success: !result.error, error: result.error?.message };
  }

  if (intent === "clockOut") {
    const clockOutTime = formData.get("clockOut") as string | null;
    const note = formData.get("note") as string | null;
    const result = await clockOut({
      employeeId: userId,
      companyId,
      updatedBy: userId,
      clockOut: clockOutTime ?? undefined,
      note: note ?? undefined
    });
    return { success: !result.error, error: result.error?.message };
  }

  return { success: false, error: "Unknown intent" };
}
