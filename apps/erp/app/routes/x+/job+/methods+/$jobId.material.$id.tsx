import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { jobMaterialValidator } from "~/modules/production";
import {
  recalculateJobMakeMethodRequirements,
  recalculateJobOperationDependencies,
  upsertJobMaterial
} from "~/modules/production/production.service.server";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production",
    bypassRls: true
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

  const updateJobMaterial = await upsertJobMaterial({
    jobId,
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateJobMaterial.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateJobMaterial.error, "Failed to update job material")
      )
    );
  }

  const jobMaterialId = updateJobMaterial.data?.id;
  if (!jobMaterialId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateJobMaterial, "Failed to update job material")
      )
    );
  }

  if (validation.data.methodType === "Make to Order") {
    const promises = [
      recalculateJobMakeMethodRequirements({
        id: validation.data.jobMakeMethodId
      })
    ];

    if (validation.data.jobOperationId) {
      promises.push(
        recalculateJobOperationDependencies({
          jobId
        })
      );
    }

    const [recalculateResult, recalculateDependencies] =
      await Promise.all(promises);

    if (recalculateResult.error) {
      return data(
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

    if (recalculateDependencies?.error) {
      return data(
        { id: jobMaterialId },
        await flash(
          request,
          error(
            recalculateDependencies.error,
            "Failed to recalculate job operation dependencies"
          )
        )
      );
    }
  } else {
    const recalculateResult = await recalculateJobMakeMethodRequirements({
      id: validation.data.jobMakeMethodId
    });

    if (recalculateResult.error) {
      return data(
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
  }

  return {
    id: jobMaterialId,
    methodType: updateJobMaterial.data.methodType,
    success: true,
    message: "Material updated"
  };
}
