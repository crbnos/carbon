import { requirePermissions } from "@carbon/auth/auth.server";
import { getLocalTimeZone, now } from "@internationalized/date";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { endProductionEvents } from "~/services/jobs.service";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const formData = await request.formData();
  const timezone = formData.get("timezone") as string | null;

  const updates = await endProductionEvents(client, {
    companyId,
    employeeId: userId,
    endTime: now(timezone ?? getLocalTimeZone()).toAbsoluteString(),
  });

  if (updates.error) {
    return json(
      { success: false, message: updates.error.message },
      { status: 500 }
    );
  }

  return json({ success: true, message: "Successfully ended shift" });
}
