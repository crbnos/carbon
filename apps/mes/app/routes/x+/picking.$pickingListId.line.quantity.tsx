// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { userContext } from "~/context";
import { pickQuantity } from "~/services/commands.picking.server";

export async function action({ context, request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();

  const result = await pickQuantity(
    serviceRole,
    { companyId, userId: effectiveUserId },
    {
      pickingListLineId: formData.get("pickingListLineId") as string,
      quantity: Number(formData.get("quantity") ?? 0),
      markShort: formData.get("markShort") === "true"
    }
  );

  if (!result.ok) {
    return { success: false, message: result.failure.message };
  }

  return { success: true, data: result.data };
}
