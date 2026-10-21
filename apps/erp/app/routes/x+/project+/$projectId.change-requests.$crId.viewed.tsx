// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { projectPlanTables } from "~/modules/projects/projects.models";

const logger = getLogger("erp", "project-change-request-viewed");

/**
 * Marks one changed row of a change request viewed by the user, or clears the
 * mark. A later change of the row makes the mark stale (the review loader
 * compares `viewedAt` with the items' last change).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "projects"
  });

  const { crId } = params;
  if (!crId) throw new Error("Could not find crId");

  const formData = await request.formData();
  const targetTable = formData.get("targetTable");
  const targetId = formData.get("targetId");
  if (
    typeof targetId !== "string" ||
    !targetId ||
    !projectPlanTables.includes(targetTable as never)
  ) {
    return data(
      { success: false },
      await flash(request, error(null, "Choose a row"))
    );
  }
  const key = {
    changeRequestId: crId,
    targetTable: targetTable as (typeof projectPlanTables)[number],
    targetId,
    userId,
    companyId
  };

  const result =
    formData.get("viewed") === "true"
      ? await client
          .from("projectChangeRequestView")
          .upsert({ ...key, viewedAt: datetime.timestamp() })
      : await client
          .from("projectChangeRequestView")
          .delete()
          .eq("changeRequestId", crId)
          .eq("targetTable", key.targetTable)
          .eq("targetId", targetId)
          .eq("userId", userId)
          .eq("companyId", companyId);
  if (result.error) {
    logger.error("Failed to save the viewed mark", {
      companyId,
      changeRequestId: crId,
      error: result.error
    });
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to save the mark"))
    );
  }
  return data({ success: true });
}
