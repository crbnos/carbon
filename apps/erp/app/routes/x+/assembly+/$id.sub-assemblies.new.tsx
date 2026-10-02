// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblySubAssemblyNewValidator,
  makeAssemblySubAssembly
} from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "assembly-sub-assembly-new");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw notFound("id is not found");

  const validation = await validator(assemblySubAssemblyNewValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(validation.error, "Failed to make sub-assembly")
      )
    );
  }

  try {
    const headerId = await makeAssemblySubAssembly(getDatabaseClient(), {
      assemblyInstructionId: id,
      stepId: validation.data.stepId,
      companyId,
      userId
    });
    return { success: true, id: headerId };
  } catch (err) {
    logger.error("Failed to make sub-assembly", {
      companyId,
      assemblyInstructionId: id,
      stepId: validation.data.stepId,
      error: err
    });
    return data(
      { success: false },
      await flash(
        request,
        error(
          err,
          err instanceof Error ? err.message : "Failed to make sub-assembly"
        )
      )
    );
  }
}
