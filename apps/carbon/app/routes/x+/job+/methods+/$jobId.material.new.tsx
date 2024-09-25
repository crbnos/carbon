import { getCarbonServiceRole } from "@carbon/auth";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import {
  jobMaterialValidator,
  recalculateJobMakeMethodRequirements,
  upsertJobMaterial,
  upsertJobMaterialMakeMethod,
} from "~/modules/production";
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

  const { jobId } = params;
  if (!jobId) {
    throw new Error("jobId not found");
  }

  const formData = await request.formData();
  const validation = await validator(jobMaterialValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const serviceRole = getCarbonServiceRole();
  const insertJobMaterial = await upsertJobMaterial(serviceRole, {
    ...data,
    jobId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertJobMaterial.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertJobMaterial.error, "Failed to insert job material")
      )
    );
  }

  const jobMaterialId = insertJobMaterial.data?.id;
  if (!jobMaterialId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertJobMaterial, "Failed to insert job material")
      )
    );
  }

  if (data.methodType === "Make") {
    const makeMethod = await upsertJobMaterialMakeMethod(serviceRole, {
      sourceId: data.itemId,
      targetId: jobMaterialId,
      companyId,
      userId,
    });

    if (makeMethod.error) {
      return json(
        {
          id: jobMaterialId,
        },
        await flash(
          request,
          error(makeMethod.error, "Failed to insert job material make method")
        )
      );
    }
  }

  const recalculateResult = await recalculateJobMakeMethodRequirements(
    serviceRole,
    {
      id: validation.data.jobMakeMethodId,
      companyId,
      userId,
    }
  );

  if (recalculateResult.error) {
    return json(
      { id: jobMaterialId },
      await flash(
        request,
        error(
          recalculateResult.error,
          "Failed to recalculate job make method requirements"
        )
      )
    );
  }

  return json({ id: jobMaterialId });
}
