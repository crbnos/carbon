import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import invariant from "tiny-invariant";
import { inspectionMeasurementValidator } from "~/modules/quality";
import { upsertInspectionMeasurement } from "~/modules/quality/quality.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const formData = await request.formData();
  const validation = await validator(inspectionMeasurementValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  if (validation.data.inspectionId !== id) {
    return data(
      { error: { message: "Inspection id mismatch" } },
      await flash(request, error(null, "Inspection id mismatch"))
    );
  }

  const result = await upsertInspectionMeasurement({
    ...validation.data,
    companyId,
    userId
  });

  if (result.error) {
    return data(
      { error: result.error },
      await flash(request, error(result.error, "Failed to save measurement"))
    );
  }

  // No success flash — per-cell saves must be quiet; the grid consumes the
  // returned ids/statuses to update itself.
  return data(result);
}
