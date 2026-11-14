// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { resolveMaterialRequest } from "@carbon/database/material-request";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";

const logger = getLogger("mes", "line-feed-resolve");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  // The user's own client: the materialRequest RLS policy lets the requester
  // or an inventory editor resolve a request.
  const { client, companyId, userId } = await requirePermissions(request, {});

  const { materialRequestId } = params;
  if (!materialRequestId) {
    return { success: false, message: "Missing materialRequestId" };
  }

  const result = await resolveMaterialRequest(client, {
    id: materialRequestId,
    companyId,
    userId,
    at: datetime.timestamp()
  });

  if (result.error) {
    logger.error("Failed to resolve material request", {
      companyId,
      materialRequestId,
      error: result.error
    });
    return {
      success: false,
      message:
        result.error.code === "CARBON_NOT_APPLIED"
          ? "Only the requester or an inventory editor can resolve this request"
          : (result.error.message ?? "Failed to resolve material request")
    };
  }

  return { success: true };
}
