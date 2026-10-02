// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { recordInspectionSample } from "~/services/commands.inspection.server";
import { getDatabaseClient } from "~/services/database.server";
import { inspectionSampleValidator } from "~/services/models";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  // Quiet saves come from the measurement matrix's "Overall result" cells via
  // a raw fetch (no revalidation), so a flash cookie would surface as a stray
  // toast on the next navigation — suppress it and just return the sample id.
  const quiet = formData.get("quiet") === "true";
  const validation = await validator(inspectionSampleValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  if (validation.data.inspectionId !== id) {
    return data(
      { error: { message: "Inspection id mismatch" } },
      await flash(request, error(null, "Inspection id mismatch"))
    );
  }

  const result = await recordInspectionSample(
    getDatabaseClient(),
    { companyId, userId },
    { ...validation.data, inspectionId: id }
  );

  if (!result.ok) {
    const { failure } = result;
    return data(
      { error: failure.details ?? { message: failure.message } },
      await flash(
        request,
        failure.fields?.trackedEntityId
          ? error(null, failure.message)
          : error(failure.details ?? null, "Failed to save sample")
      )
    );
  }

  if (quiet) {
    return data({ success: true, sampleId: result.data.sampleId });
  }

  return data(
    { success: true, sampleId: result.data.sampleId },
    await flash(request, success("Sample recorded"))
  );
}
