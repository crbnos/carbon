import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import {
  jobMaterialValidator,
  recalculateJobMakeMethodRequirements,
  recalculateJobOperationDependencies,
  upsertJobMaterial,
  upsertJobMaterialMakeMethod
} from "~/modules/production";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production"
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

  const serviceRole = getCarbonServiceRole();
  const insertJobMaterial = await upsertJobMaterial(serviceRole, {
    ...validation.data,
    jobId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertJobMaterial.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertJobMaterial.error, "Failed to insert job material")
      )
    );
  }

  const jobMaterialId = insertJobMaterial.data?.id;
  if (!jobMaterialId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(insertJobMaterial, "Failed to insert job material")
      )
    );
  }

  // Check if job is released (not Draft or Planned)
  const job = await serviceRole
    .from("job")
    .select("status")
    .eq("id", jobId)
    .single();
  const isReleased = !["Draft", "Planned"].includes(job.data?.status ?? "");

  if (validation.data.methodType === "Make") {
    const materialMakeMethod = await serviceRole
      .from("jobMaterialWithMakeMethodId")
      .select("*")
      .eq("id", jobMaterialId)
      .single();
    if (materialMakeMethod.error) {
      return data(
        {
          id: null
        },
        await flash(
          request,
          error(materialMakeMethod.error, "Failed to get material make method")
        )
      );
    }
    const makeMethod = await upsertJobMaterialMakeMethod(serviceRole, {
      sourceId: validation.data.itemId,
      targetId: materialMakeMethod.data?.jobMaterialMakeMethodId!,
      companyId,
      userId
    });

    if (makeMethod.error) {
      return data(
        {
          id: jobMaterialId
        },
        await flash(
          request,
          error(makeMethod.error, "Failed to insert job material make method")
        )
      );
    }
  }

  // Recalculate for ALL material types if job is released
  if (isReleased) {
    const promises = [
      recalculateJobMakeMethodRequirements(serviceRole, {
        id: validation.data.jobMakeMethodId,
        companyId,
        userId
      })
    ];

    if (validation.data.jobOperationId) {
      promises.push(
        recalculateJobOperationDependencies(serviceRole, {
          jobId,
          companyId,
          userId
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
  }

  return {
    id: jobMaterialId,
    success: true,
    message: "Material created"
  };
}
