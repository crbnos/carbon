import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import invariant from "tiny-invariant";
import { inboundInspectionSampleValidator } from "~/modules/quality";
import { upsertInboundInspectionSample } from "~/modules/quality/quality.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const formData = await request.formData();
  const validation = await validator(inboundInspectionSampleValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  if (validation.data.inspectionId !== id) {
    return data(
      { error: { message: "Inspection id mismatch" } },
      await flash(request, error(null, "Inspection id mismatch"))
    );
  }

  const result = await upsertInboundInspectionSample({
    ...validation.data,
    companyId,
    inspectedBy: userId
  });

  if (result.error) {
    return data(
      { error: result.error },
      await flash(request, error(result.error, "Failed to save sample"))
    );
  }

  return data(
    { success: true },
    await flash(request, success("Sample recorded"))
  );
}
