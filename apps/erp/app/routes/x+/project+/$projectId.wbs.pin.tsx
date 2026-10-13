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
  pinProjectWbsCodes,
  requireEditablePlanRoute
} from "~/modules/projects/projects.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-wbs-pin");

/**
 * Pins every derived WBS code of the project, as a contractor does at award:
 * afterwards a move keeps each element's code. A plan-layer change: refused
 * on a locked plan.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const locked = await requireEditablePlanRoute(request, {
    client,
    projectId,
    companyId,
    changeRequestId: null
  });
  if (locked) return locked;

  try {
    const count = await pinProjectWbsCodes(getDatabaseClient(), {
      companyId,
      userId,
      projectId
    });
    return data(
      { success: true },
      await flash(request, success(`${count} WBS codes pinned`))
    );
  } catch (err) {
    logger.error("Failed to pin the WBS codes", {
      companyId,
      projectId,
      error: err
    });
    return data(
      { success: false },
      await flash(request, error(err, "Failed to pin the WBS codes"))
    );
  }
}
