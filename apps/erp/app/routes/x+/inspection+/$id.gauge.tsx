import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import invariant from "tiny-invariant";
import { inspectionGaugeValidator } from "~/modules/quality";
import { recordInspectionGauge } from "~/modules/quality/quality.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

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

  const result = await recordInspectionGauge({
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

  // Quiet like the per-cell measurement saves — the grid updates itself.
  return data(result);
}
