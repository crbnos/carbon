import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import invariant from "tiny-invariant";
import { inspectionSampleValidator } from "~/modules/quality";
import { upsertInspectionSample } from "~/modules/quality/quality.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const formData = await request.formData();
  // Quiet saves come from the measurement grid's "Overall result" cells via a
  // raw fetch (no revalidation), so a flash cookie would surface as a stray
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

  const result = await upsertInspectionSample({
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

  if (quiet) {
    return data({ success: true, sampleId: result.data.id });
  }

  return data(
    { success: true, sampleId: result.data.id },
    await flash(request, success("Sample recorded"))
  );
}
