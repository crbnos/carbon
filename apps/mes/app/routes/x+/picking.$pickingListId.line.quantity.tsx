// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { shouldPrintTravelers } from "@carbon/database/travelers";
import type { ActionFunctionArgs } from "react-router";
import { userContext } from "~/context";
import { setPickingListLineQuantity } from "~/services/picking.service";
import { autoPrintPickingListTravelers } from "~/services/printing.server";

export async function action({ context, request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();
  const pickingListLineId = formData.get("pickingListLineId") as string;
  const quantity = Number(formData.get("quantity") ?? 0);
  const markShort = formData.get("markShort") === "true";

  const { pickingListId } = params;
  if (!pickingListId) {
    return { success: false, message: "Missing pickingListId" };
  }
  if (!pickingListLineId) {
    return { success: false, message: "Missing pickingListLineId" };
  }

  // A first pick moves a Draft list to In Progress in the trigger, which
  // prints the travelers the status change would have printed.
  const before = await serviceRole
    .from("pickingList")
    .select("id, status, locationId")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .maybeSingle();

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

  // After the pick, so a print failure never blocks it.
  if (before.data?.status === "Draft") {
    const after = await serviceRole
      .from("pickingList")
      .select("status")
      .eq("id", pickingListId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (shouldPrintTravelers(before.data.status, after.data?.status)) {
      await autoPrintPickingListTravelers({
        serviceRole,
        pickingListId,
        locationId: before.data.locationId,
        companyId,
        userId: effectiveUserId
      });
    }
  }

  return { success: true, data: result.data };
}
