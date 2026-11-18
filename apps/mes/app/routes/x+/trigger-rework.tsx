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
import {
  CORRECTION_TARGET_PREFIX,
  triggerReworkValidator
} from "~/services/models";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId, caller, permissions } = await requirePermissions(
    request,
    {}
  );

  const formData = await request.formData();
  const validation = await validator(triggerReworkValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    trackedEntityIds: trackedEntityIdsJson,
    targetJobOperationId,
    ...reworkData
  } = validation.data;
  const trackedEntityIds = trackedEntityIdsJson
    ? JSON.parse(trackedEntityIdsJson)
    : undefined;

  // The target is an earlier operation, or one of the part's corrections
  // (for example a "send to rework station" routing).
  const jobCorrectionId = targetJobOperationId.startsWith(
    CORRECTION_TARGET_PREFIX
  )
    ? targetJobOperationId.slice(CORRECTION_TARGET_PREFIX.length)
    : null;

  // The correction posting runs as the system, so it checks nothing about
  // the caller. An API key needs the production update scope, as on
  // `trigger-correction.tsx`.
  if (
    jobCorrectionId &&
    caller === "apiKey" &&
    !permissions.production?.update?.includes(companyId)
  ) {
    return data(
      {},
      await flash(request, error(null, "This API key cannot update production"))
    );
  }

  const result = jobCorrectionId
    ? await erpPosting(
        "trigger-correction",
        { companyId, userId },
        { ...reworkData, jobCorrectionId, trackedEntityIds }
      )
    : await erpPosting(
        "trigger-rework",
        { companyId, userId },
        { ...reworkData, targetJobOperationId, trackedEntityIds }
      );

  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(
          result.error,
          jobCorrectionId
            ? "Failed to start correction"
            : "Failed to trigger rework"
        )
      )
    );
  }

  // Trigger quantity recalculation
  await erpPosting(
    "recalculate",
    { companyId, userId },
    {
      type: "jobRequirements",
      id: validation.data.jobId
    }
  );

  return data(
    result.data,
    await flash(
      request,
      success(
        jobCorrectionId ? "Correction started" : "Rework triggered successfully"
      )
    )
  );
}
