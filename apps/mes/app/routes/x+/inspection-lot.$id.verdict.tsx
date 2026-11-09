// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { dispositionInspection } from "@carbon/database/quality";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { inspectionVerdictValidator } from "~/services/models";
import { readOrigin, withOrigin } from "~/utils/origin";
import { path } from "~/utils/path";

// Accept or Reject a manual inspection. The engine moves the lot's tracked
// entities (Accept → Available, failed units stay Rejected; Reject → all
// Rejected) and records the verdict; there is no production posting. Manual
// lots only, and one-shot, like every MES disposition.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  const validation = await validator(inspectionVerdictValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const { decision, reason } = validation.data;
  const origin = readOrigin(formData);

  const result = await dispositionInspection(getDatabaseClient(), {
    id,
    decision,
    reason,
    companyId,
    dispositionedBy: userId,
    requireSource: "Manual",
    requireOpen: true
  });

  if (result.error) {
    throw redirect(
      withOrigin(path.to.manualInspection(id), origin),
      await flash(
        request,
        error(
          result.error,
          decision === "Accept"
            ? "Failed to accept inspection"
            : "Failed to reject inspection"
        )
      )
    );
  }

  throw redirect(
    origin ?? path.to.inspections,
    await flash(
      request,
      success(
        decision === "Accept" ? "Inspection accepted" : "Inspection rejected"
      )
    )
  );
}
