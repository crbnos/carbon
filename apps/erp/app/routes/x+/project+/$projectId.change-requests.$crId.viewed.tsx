// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { projectPlanTables } from "~/modules/projects/projects.models";

/**
 * Marks one changed row of a change request viewed by the user, or clears the
 * mark. A later change of the row makes the mark stale (the review loader
 * compares `viewedAt` with the items' last change).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
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

  const api = await carbon(request);
  const result = await api.projects.updateProjectChangeRequestView({
    changeRequestId: crId,
    targetTable: targetTable as (typeof projectPlanTables)[number],
    targetId,
    viewed: formData.get("viewed") === "true"
  });
  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(null, result.error.message))
    );
  }
  return data({ success: true });
}
