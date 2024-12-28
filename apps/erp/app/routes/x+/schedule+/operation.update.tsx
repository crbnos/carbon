import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { scheduleOperationUpdateValidator } from "~/modules/production/production.models";
export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "production",
  });
  const validation = await validator(scheduleOperationUpdateValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return json({
      success: false,
      message: "Invalid form data",
    });
  }

  const { error } = await client
    .from("jobOperation")
    .update({
      workCenterId: validation.data.columnId,
      priority: validation.data.priority,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", validation.data.id);

  if (error) {
    return json({ success: false, message: error.message });
  }

  return json({ success: true });
}
