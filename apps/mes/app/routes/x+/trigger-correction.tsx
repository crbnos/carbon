// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { erpPosting } from "~/services/erp";
import { triggerCorrectionValidator } from "~/services/models";

/** Sends a unit through the correction the operator confirmed. */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId, caller, permissions } = await requirePermissions(
    request,
    {}
  );
  // The posting runs as the system, so it checks nothing about the caller.
  // An operator on the floor may start a correction; an API key needs the
  // production update scope, the posting's own rule (`triggerCorrectionPermission`).
  if (
    caller === "apiKey" &&
    !permissions.production?.update?.includes(companyId)
  ) {
    return data(
      { success: false },
      await flash(request, error(null, "This API key cannot update production"))
    );
  }

  const formData = await request.formData();
  const validation = await validator(triggerCorrectionValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { trackedEntityId, ...correction } = validation.data;

  const result = await erpPosting(
    "trigger-correction",
    { companyId, userId },
    {
      ...correction,
      trackedEntityIds: trackedEntityId ? [trackedEntityId] : undefined
    }
  );

  if (result.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(
          result.error,
          result.error.message ?? "Failed to start correction"
        )
      )
    );
  }

  // The correction's operations and materials change what the job needs.
  await erpPosting(
    "recalculate",
    { companyId, userId },
    { type: "jobRequirements", id: correction.jobId }
  );

  return data(
    { success: true },
    await flash(request, success("Correction started"))
  );
}
