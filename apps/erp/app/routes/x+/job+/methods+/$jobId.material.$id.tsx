import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
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
  const { client, companyId, userId } = await requirePermissions(request, {
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

  // Capture the previous methodType so we only pull the subassembly's method on
  // the transition INTO "Make to Order" (not on every save of a material that is
  // already Make to Order — that would re-pull and wipe existing edits).
  const existingMaterial = await client
    .from("jobMaterial")
    .select("methodType")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (existingMaterial.error) {
    return data(
      { id: null },
      await flash(
        request,
        error(existingMaterial.error, "Failed to load job material")
      )
    );
  }
  const wasMakeToOrder = existingMaterial.data?.methodType === "Make to Order";

  const updateJobMaterial = await upsertJobMaterial(client, {
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

  // On transition Pull/Purchase → Make to Order, pull the subassembly's method
  // (BOM + operations) into the newly-created child make method, mirroring the
  // create route. Without this the material flips to Make to Order but stays empty.
  // `client` here is already service-role (requirePermissions bypassRls).
  if (validation.data.methodType === "Make to Order" && !wasMakeToOrder) {
    const makeMethod = await pullJobMaterialMakeMethod(client, {
      jobMaterialId,
      itemId: validation.data.itemId,
      companyId,
      userId
    });
    if (makeMethod.error) {
      return data(
        { id: jobMaterialId },
        await flash(
          request,
          error(makeMethod.error, "Failed to insert job material make method")
        )
      );
    }
  }

  if (validation.data.methodType === "Make to Order") {
    const promises = [
      recalculateJobMakeMethodRequirements(client, {
        id: validation.data.jobMakeMethodId,
        companyId,
        userId
      })
    ];

    if (validation.data.jobOperationId) {
      promises.push(
        recalculateJobOperationDependencies(client, {
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
  } else {
    const recalculateResult = await recalculateJobMakeMethodRequirements(
      client,
      {
        id: validation.data.jobMakeMethodId,
        companyId,
        userId
      }
    );

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
