import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { getSupabaseServiceRole } from "~/lib/supabase";
import { jobMaterialValidator, upsertJobMaterial } from "~/modules/production";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production",
  });

  const { jobId, id } = params;
  if (!jobId) {
    throw new Error("jobId not found");
  }

  if (!id) {
    throw new Error("id not found");
  }

  const formData = await request.formData();
  const validation = await validator(jobMaterialValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = getSupabaseServiceRole();
  const updateJobMaterial = await upsertJobMaterial(serviceRole, {
    jobId,
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateJobMaterial.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateJobMaterial.error, "Failed to update job material")
      )
    );
  }

  const jobMaterialId = updateJobMaterial.data?.id;
  if (!jobMaterialId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateJobMaterial, "Failed to update job material")
      )
    );
  }

  return json({
    id: jobMaterialId,
    methodType: updateJobMaterial.data.methodType,
  });
}
