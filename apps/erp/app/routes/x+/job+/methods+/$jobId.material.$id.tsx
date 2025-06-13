import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import {
  jobMaterialValidator,
  recalculateJobMakeMethodRequirements,
  recalculateJobOperationDependencies,
  runMRP,
  upsertJobMaterial,
} from "~/modules/production";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
    bypassRls: true,
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

  const updateJobMaterial = await upsertJobMaterial(client, {
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

  if (validation.data.methodType === "Make") {
    const promises = [
      recalculateJobMakeMethodRequirements(client, {
        id: validation.data.jobMakeMethodId,
        companyId,
        userId,
      }),
    ];

    if (validation.data.jobOperationId) {
      promises.push(
        recalculateJobOperationDependencies(client, {
          jobId,
          companyId,
          userId,
        })
      );
    }

    const [recalculateResult, recalculateDependencies] = await Promise.all(
      promises
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

    if (recalculateDependencies?.error) {
      return json(
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
    const recalculateResult = await recalculateJobMakeMethodRequirements(
      client,
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
  }

  await runMRP(client, {
    type: "item",
    id: validation.data.itemId,
    companyId,
    userId,
  });

  return json({
    id: jobMaterialId,
    methodType: updateJobMaterial.data.methodType,
  });
}
