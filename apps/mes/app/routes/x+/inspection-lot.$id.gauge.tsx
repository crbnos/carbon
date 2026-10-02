// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { setInspectionGauge } from "~/services/commands.inspection.server";
import { getDatabaseClient } from "~/services/database.server";
import { inspectionGaugeValidator } from "~/services/models";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { id } = params;
  if (!id) throw new Error("id is required");

  const formData = await request.formData();
  const validation = await validator(inspectionGaugeValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  if (validation.data.inspectionId !== id) {
    return data(
      { error: { message: "Inspection id mismatch" } },
      await flash(request, error(null, "Inspection id mismatch"))
    );
  }

  const result = await setInspectionGauge(
    getDatabaseClient(),
    { companyId, userId },
    {
      inspectionId: id,
      inspectionFeatureId: validation.data.inspectionFeatureId,
      gaugeId: validation.data.gaugeId
    }
  );

  if (!result.ok) {
    return data(
      { error: result.failure.details ?? { message: result.failure.message } },
      await flash(
        request,
        error(result.failure.details ?? null, "Failed to record gauge")
      )
    );
  }

  // Quiet like the per-cell measurement saves — the matrix updates itself.
  return data({ data: result.data, error: null });
}
