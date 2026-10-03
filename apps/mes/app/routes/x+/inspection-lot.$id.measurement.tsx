// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { recordInspectionMeasurement } from "~/services/commands.inspection.server";
import { getDatabaseClient } from "~/services/database.server";
import { inspectionMeasurementValidator } from "~/services/models";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  const validation = await validator(inspectionMeasurementValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  // The form carries the lot id as well as the path; only this client sends it
  // twice, so the two-source check stays here rather than in the command.
  if (validation.data.inspectionId !== id) {
    return data(
      { error: { message: "Inspection id mismatch" } },
      await flash(request, error(null, "Inspection id mismatch"))
    );
  }

  const result = await recordInspectionMeasurement(
    getDatabaseClient(),
    { companyId, userId },
    { ...validation.data, inspectionId: id }
  );

  if (!result.ok) {
    return data(
      { error: result.failure.details ?? { message: result.failure.message } },
      await flash(
        request,
        error(result.failure.details ?? null, "Failed to save measurement")
      )
    );
  }

  // No success flash — per-cell saves must be quiet; the matrix consumes the
  // returned ids/statuses to update itself.
  return data({ data: result.data, error: null });
}
