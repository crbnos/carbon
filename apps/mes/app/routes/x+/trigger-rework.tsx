// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  triggerCorrectionPermission,
  triggerReworkPermission
} from "@carbon/api/postings";
import { assertIsPost, error, success } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { holdsGate } from "@carbon/database/access";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { erpPosting } from "~/services/erp";
import {
  correctionIdOfTarget,
  triggerReworkValidator
} from "~/services/models";

const log = getLogger("mes");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId, caller, permissions } = await authorize(request);
  // Both postings run as the system, so they check nothing about the caller.
  // An operator on the floor may send a unit back; an API key needs the
  // postings' own rules.
  if (
    caller === "apiKey" &&
    !holdsGate(
      permissions,
      { ...triggerReworkPermission, ...triggerCorrectionPermission },
      companyId
    )
  ) {
    return data(
      {},
      await flash(request, error(null, "This API key cannot edit jobs"))
    );
  }

  const formData = await request.formData();
  const validation = await validator(triggerReworkValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { targetJobOperationId, ...reworkData } = validation.data;

  // The target is an earlier operation, or one of the part's corrections
  // (for example a "send to rework station" routing).
  const jobCorrectionId = correctionIdOfTarget(targetJobOperationId);

  const result =
    jobCorrectionId !== null
      ? await erpPosting(
          "trigger-correction",
          { companyId, userId },
          { ...reworkData, jobCorrectionId }
        )
      : await erpPosting(
          "trigger-rework",
          { companyId, userId },
          { ...reworkData, targetJobOperationId }
        );

  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(
          result.error,
          jobCorrectionId !== null
            ? "Failed to start correction"
            : "Failed to trigger rework"
        )
      )
    );
  }

  // The new operations and materials change what the job needs.
  const recalculated = await erpPosting(
    "recalculate",
    { companyId, userId },
    {
      type: "jobRequirements",
      id: validation.data.jobId
    }
  );
  if (recalculated.error) {
    log.error("Failed to recalculate job requirements after a rework", {
      jobId: validation.data.jobId,
      error: recalculated.error
    });
  }

  return data(
    result.data,
    await flash(
      request,
      success(
        jobCorrectionId !== null
          ? "Correction started"
          : "Rework triggered successfully"
      )
    )
  );
}
