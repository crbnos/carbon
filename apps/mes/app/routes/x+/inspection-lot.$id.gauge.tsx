import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { recordInspectionGauge } from "@carbon/database/quality";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
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

  const result = await recordInspectionGauge(getDatabaseClient(), {
    inspectionId: id,
    inspectionFeatureId: validation.data.inspectionFeatureId,
    gaugeId: validation.data.gaugeId || null,
    companyId,
    userId
  });

  if (result.error) {
    return data(
      { error: result.error },
      await flash(request, error(result.error, "Failed to record gauge"))
    );
  }

  // Quiet like the per-cell measurement saves — the matrix updates itself.
  return data(result);
}
