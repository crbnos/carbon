// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { createMaterialRequest } from "@carbon/database/material-request";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { userContext } from "~/context";
import { materialRequestValidator } from "~/services/models";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("mes", "material-request");

export async function action({ request, context }: ActionFunctionArgs) {
  assertIsPost(request);
  // The user's own client: the materialRequest RLS policy decides who may
  // raise a request.
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(materialRequestValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { jobOperationId, itemId, note } = validation.data;

  const result = await createMaterialRequest(client, {
    companyId,
    userId,
    jobOperationId,
    itemId,
    note,
    fallbackLocationId: context.get(userContext)?.locationId
  });

  if (result.error || !result.data) {
    logger.error("Failed to create material request", {
      companyId,
      jobOperationId,
      error: result.error
    });
    throw redirect(
      requestReferrer(request) ?? path.to.active,
      await flash(
        request,
        error(result.error, result.error ?? "Failed to request material")
      )
    );
  }

  return success("Material requested");
}
