// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { userContext } from "~/context";
import { setPickingListLineQuantity } from "~/services/picking.service";
import { printTravelersOnStart } from "~/services/printing.server";

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

  // The pick can move the list out of Draft (the status trigger), which
  // starts it. After the pick, so a print failure never blocks it.
  await printTravelersOnStart({
    serviceRole,
    pickingListId,
    companyId,
    userId: effectiveUserId
  });

  return { success: true, data: result.data };
}
