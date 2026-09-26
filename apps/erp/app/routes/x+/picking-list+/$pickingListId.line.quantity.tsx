import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { pickPickingListLine } from "~/modules/inventory";
import { requireCompanyRecord } from "~/modules/shared/shared.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });
  const { pickingListId } = params;
  if (!pickingListId) {
    return { success: false, message: "Missing pickingListId" };
  }
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();
  const pickingListLineId = formData.get("pickingListLineId") as string;
  const quantity = Number(formData.get("quantity") ?? 0);
  const markShort = formData.get("markShort") === "true";

  if (!pickingListLineId) {
    return { success: false, message: "Missing pickingListLineId" };
  }

  // The pick runs through the service role: the line must belong to this
  // company and to the picking list in the URL.
  await requireCompanyRecord(serviceRole, "pickingListLine", companyId, {
    id: pickingListLineId,
    pickingListId
  });

  const result = await pickPickingListLine(serviceRole, {
    pickingListLineId,
    quantity,
    markShort,
    userId,
    companyId
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
