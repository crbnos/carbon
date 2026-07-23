import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  jobMaterialValidator,
  pullJobMaterialMakeMethod,
  recalculateJobMakeMethodRequirements,
  recalculateJobOperationDependencies,
  upsertJobMaterial
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

  if (validation.data.methodType === "Make to Order") {
    const makeMethod = await pullJobMaterialMakeMethod(serviceRole, {
      jobMaterialId,
      itemId: validation.data.itemId,
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

    promises.push(
      recalculateJobOperationDependencies(serviceRole, {
        jobId,
        companyId,
        userId
      })
    );

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
