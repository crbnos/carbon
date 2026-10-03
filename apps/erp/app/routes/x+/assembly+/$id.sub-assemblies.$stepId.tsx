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
  assemblySubAssemblyUpdateValidator,
  updateAssemblySubAssembly
} from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "assembly-sub-assembly-update");

// Autosave target for a sub-assembly's name and "Used in" step. Only the fields
// posted are changed; an empty `usedInStepId` means it joins the main build.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id, stepId } = params;
  if (!id) throw notFound("id is not found");
  if (!stepId) throw notFound("step id is not found");

  const formData = await request.formData();
  const validation = await validator(
    assemblySubAssemblyUpdateValidator
  ).validate(formData);
  if (validation.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(validation.error, "Failed to update sub-assembly")
      )
    );
  }

  try {
    await updateAssemblySubAssembly(getDatabaseClient(), {
      assemblyInstructionId: id,
      headerId: stepId,
      title: formData.has("title") ? (validation.data.title ?? "") : undefined,
      usedInStepId: formData.has("usedInStepId")
        ? (validation.data.usedInStepId ?? null)
        : undefined,
      companyId,
      userId
    });
    return { success: true };
  } catch (err) {
    logger.error("Failed to update sub-assembly", {
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
          err instanceof Error ? err.message : "Failed to update sub-assembly"
        )
      )
    );
  }
}
