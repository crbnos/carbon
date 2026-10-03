// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyInstructionStepNewValidator,
  insertAssemblyInstructionStep
} from "~/modules/production";
import {
  logAssemblyStep,
  readAndLogFormData
} from "~/modules/production/assembly-debug.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "assembly-step-new");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { id: assemblyInstructionId } = params;
  if (!assemblyInstructionId) throw new Error("id is not found");

  const formData = await readAndLogFormData(request, "new.action");
  const validation = await validator(
    assemblyInstructionStepNewValidator
  ).validate(formData);

  if (validation.error) {
    logAssemblyStep("new.validationError", { error: validation.error });
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to create step"))
    );
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is never set on create
  const { id, ...rest } = validation.data;

  try {
    const stepId = await insertAssemblyInstructionStep(getDatabaseClient(), {
      ...rest,
      assemblyInstructionId,
      companyId,
      userId
    });
    logAssemblyStep("new.result", {
      createdId: stepId,
      componentNodeIds: rest.componentNodeIds
    });
    return { success: true, id: stepId };
  } catch (err) {
    logger.error("Failed to insert assembly instruction step", {
      companyId,
      assemblyInstructionId,
      parentStepId: rest.parentStepId ?? null,
      error: err
    });
    return data(
      { success: false },
      await flash(
        request,
        error(err, "Failed to insert assembly instruction step")
      )
    );
  }
}
