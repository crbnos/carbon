import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { userContext } from "~/context";
import { isPickingListLocked, pickingListStatus } from "~/services/models";
import { updatePickingListStatus } from "~/services/picking.service";

type PickingListStatus = (typeof pickingListStatus)[number];

export async function action({ context, request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const serviceRole = getCarbonServiceRole();

  const pickingListId = params.pickingListId;
  const formData = await request.formData();
  const status = formData.get("status") as string;

  if (!pickingListId) {
    return { success: false, message: "Missing pickingListId" };
  }
  if (!pickingListStatus.includes(status as PickingListStatus)) {
    return { success: false, message: "Invalid status" };
  }

  // Reopening a closed picking list is ERP-only — MES may not unlock one.
  const current = await serviceRole
    .from("pickingList")
    .select("status")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .single();
  if (
    isPickingListLocked(current.data?.status) &&
    !isPickingListLocked(status)
  ) {
    return {
      success: false,
      message: "Reopen this picking list from the ERP."
    };
  }

  const result = await updatePickingListStatus(
    serviceRole,
    pickingListId,
    status as PickingListStatus,
    effectiveUserId,
    companyId
  );

  if (result.error) {
    return { success: false, message: "Failed to update picking list status" };
  }

  return { success: true };
}
