// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { ungroupAssemblySubAssembly } from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "assembly-sub-assembly-ungroup");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id, stepId } = params;
  if (!id) throw notFound("id is not found");
  if (!stepId) throw notFound("step id is not found");

  try {
    await ungroupAssemblySubAssembly(getDatabaseClient(), {
      assemblyInstructionId: id,
      headerId: stepId,
      companyId,
      userId
    });
    return { success: true };
  } catch (err) {
    logger.error("Failed to ungroup sub-assembly", {
      companyId,
      assemblyInstructionId: id,
      headerId: stepId,
      error: err
    });
    return data(
      { success: false },
      await flash(
        request,
        error(
          err,
          err instanceof Error ? err.message : "Failed to ungroup sub-assembly"
        )
      )
    );
  }
}
