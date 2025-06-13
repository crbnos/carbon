import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
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
  upsertJobMaterialMakeMethod,
} from "~/modules/production";
import { setCustomFields } from "~/utils/form";

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
    const materialMakeMethod = await serviceRole
      .from("jobMaterialWithMakeMethodId")
      .select("*")
      .eq("id", jobMaterialId)
      .single();
    if (materialMakeMethod.error) {
      return json(
        {
          id: null,
        },
        await flash(
          request,
          error(materialMakeMethod.error, "Failed to get material make method")
        )
      );
    }
    const makeMethod = await upsertJobMaterialMakeMethod(serviceRole, {
      sourceId: data.itemId,
      targetId: materialMakeMethod.data?.jobMaterialMakeMethodId!,
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

    const promises = [
      recalculateJobMakeMethodRequirements(serviceRole, {
        id: validation.data.jobMakeMethodId,
        companyId,
        userId,
      }),
    ];

    if (validation.data.jobOperationId) {
      promises.push(
        recalculateJobOperationDependencies(serviceRole, {
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

    await runMRP(serviceRole, {
      type: "item",
      id: validation.data.itemId,
      companyId,
      userId,
    });
  }

  return json({ id: jobMaterialId });
}
