import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  getJobMethodValidator,
  recalculateJobOperationDependencies,
  recalculateJobRequirements,
  upsertJobMaterialMakeMethod,
  upsertJobMethod
} from "~/modules/production";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const type = formData.get("type") as string;
  const configurationStr = formData.get("configuration") as string | null;
  const configuration = configurationStr
    ? JSON.parse(configurationStr)
    : undefined;

  const serviceRole = getCarbonServiceRole();

  const validation = await validator(getJobMethodValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  if (["item", "quoteLine"].includes(type)) {
    const jobMethodPayload: any = {
      ...validation.data,
      companyId,
      userId,
      parts: {
        billOfMaterial: validation.data.billOfMaterial,
        billOfProcess: validation.data.billOfProcess,
        parameters: validation.data.parameters,
        tools: validation.data.tools,
        steps: validation.data.steps,
        workInstructions: validation.data.workInstructions
      }
    };

    // Only add configuration if it exists
    if (configuration !== undefined && type === "item") {
      jobMethodPayload.configuration = configuration;
    }

    const jobMethod = await upsertJobMethod(
      serviceRole,
      type === "item" ? "itemToJob" : "quoteLineToJob",
      jobMethodPayload
    );

    const [calculateQuantities, calculateDependencies] = await Promise.all([
      recalculateJobRequirements(serviceRole, {
        id: validation.data.targetId,
        companyId: companyId,
        userId: userId
      }),
      recalculateJobOperationDependencies(serviceRole, {
        jobId: validation.data.targetId,
        companyId: companyId,
        userId: userId
      })
    ]);

    if (calculateQuantities.error) {
      return {
        error: "Failed to calculate job quantities"
      };
    }

    if (calculateDependencies.error) {
      return {
        error: "Failed to calculate job dependencies"
      };
    }

    return {
      error: jobMethod.error ? "Failed to get job method" : null
    };
  }

  if (type === "method") {
    const makeMethodPayload: any = {
      ...validation.data,
      companyId,
      userId,
      parts: {
        billOfMaterial: validation.data.billOfMaterial,
        billOfProcess: validation.data.billOfProcess,
        parameters: validation.data.parameters,
        tools: validation.data.tools,
        steps: validation.data.steps,
        workInstructions: validation.data.workInstructions
      }
    };

    // Only add configuration if it exists
    if (configuration !== undefined) {
      makeMethodPayload.configuration = configuration;
    }

    const makeMethod = await upsertJobMaterialMakeMethod(
      serviceRole,
      makeMethodPayload
    );

    if (makeMethod.error) {
      return {
        error: makeMethod.error
          ? "Failed to update method from job method"
          : null
      };
    }

    throw redirect(requestReferrer(request) ?? path.to.jobs);
  }

  return data({ error: "Invalid type" }, { status: 400 });
}
