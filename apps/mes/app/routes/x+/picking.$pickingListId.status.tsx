// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { userContext } from "~/context";
import {
  setPickingListStatus,
  unresolvedLinesFrom
} from "~/services/commands.picking.server";

export async function action({ context, request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();

  const result = await setPickingListStatus(
    serviceRole,
    { companyId, userId: effectiveUserId },
    {
      pickingListId: params.pickingListId,
      status: formData.get("status") as string,
      acknowledged: formData.get("acknowledged") === "true"
    }
  );

  if (result.ok) {
    return { success: true };
  }

  // The four outcome shapes `PickingListControls` reads. `blocked` carries the
  // message as well; `needsAcknowledgement` deliberately carries none — the
  // dialog names the lines itself.
  const { failure } = result;

  if (failure.kind === "blocked") {
    return {
      success: false,
      blocked: true,
      unresolvedLines: unresolvedLinesFrom(failure),
      message: failure.message
    };
  }

  if (failure.kind === "needs_acknowledgement") {
    return {
      success: false,
      needsAcknowledgement: true,
      unresolvedLines: unresolvedLinesFrom(failure)
    };
  }

  return { success: false, message: failure.message };
}
