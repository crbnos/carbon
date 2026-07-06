import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { pickPickingListLine } from "~/modules/inventory";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "inventory"
  });
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();
  const pickingListLineId = formData.get("pickingListLineId") as string;
  const quantity = Number(formData.get("quantity") ?? 0);
  const markShort = formData.get("markShort") === "true";

  if (!pickingListLineId) {
    return { success: false, message: "Missing pickingListLineId" };
  }

  const result = await pickPickingListLine(serviceRole, {
    pickingListLineId,
    quantity,
    markShort,
    userId
  });

  if (result.error) {
    return {
      success: false,
      message:
        typeof result.error === "string"
          ? result.error
          : (result.error.message ?? "Failed to pick line")
    };
  }

  return { success: true, data: result.data };
}
