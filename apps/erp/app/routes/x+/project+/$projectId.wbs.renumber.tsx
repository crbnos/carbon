// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  renumberWbsSubtree,
  requireEditablePlanRoute
} from "~/modules/projects/projects.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-wbs-renumber");

/**
 * Clears the pinned WBS codes of an element (`elementId`) and its subtree, so
 * they derive from the tree again. A plan-layer change: refused on a locked
 * plan.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const elementId = String(formData.get("elementId") ?? "");
  if (!elementId) {
    return data(
      { success: false },
      await flash(request, error(null, "Choose an element"))
    );
  }

  const locked = await requireEditablePlanRoute(request, {
    client,
    projectId,
    companyId,
    changeRequestId: null
  });
  if (locked) return locked;

  try {
    const count = await renumberWbsSubtree(getDatabaseClient(), {
      companyId,
      userId,
      projectId,
      elementId
    });
    return data(
      { success: true },
      await flash(request, success(`${count} WBS codes unpinned`))
    );
  } catch (err) {
    logger.error("Failed to renumber the WBS", {
      companyId,
      projectId,
      elementId,
      error: err
    });
    return data(
      { success: false },
      await flash(request, error(err, "Failed to renumber the WBS"))
    );
  }
}
