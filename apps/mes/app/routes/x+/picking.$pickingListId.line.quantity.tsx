import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { userContext } from "~/context";
import { setPickingListLineQuantity } from "~/services/picking.service";

export async function action({ context, request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();
  const pickingListLineId = formData.get("pickingListLineId") as string;
  const quantity = Number(formData.get("quantity") ?? 0);
  const markShort = formData.get("markShort") === "true";

  if (!pickingListLineId) {
    return { success: false, message: "Missing pickingListLineId" };
  }

  const result = await setPickingListLineQuantity(serviceRole, {
    pickingListLineId,
    quantity,
    markShort,
    userId: effectiveUserId,
    companyId
  });

  if (result.error) {
    return {
      success: false,
      message:
        typeof result.error === "string"
          ? result.error
          : (result.error.message ?? "Failed to update pick line")
    };
  }

  return { success: true, data: result.data };
}
