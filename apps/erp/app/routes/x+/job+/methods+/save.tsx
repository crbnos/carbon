import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  getJobMethodValidator,
  upsertMakeMethodFromJob,
  upsertMakeMethodFromJobMethod
} from "~/modules/production";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const type = formData.get("type") as string;

  const serviceRole = getCarbonServiceRole();
  const validation = await validator(getJobMethodValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  if (type === "job") {
    const jobMethod = await upsertMakeMethodFromJob(serviceRole, {
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
    });

    return {
      error: jobMethod.error ? "Failed to save job method to make method" : null
    };
  }

  if (type === "method") {
    const makeMethod = await upsertMakeMethodFromJobMethod(serviceRole, {
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
    });

    if (makeMethod.error) {
      return {
        error: makeMethod.error
          ? "Failed to save job method to make method"
          : null
      };
    }

    throw redirect(requestReferrer(request) ?? path.to.jobs);
  }

  return data({ error: "Invalid type" }, { status: 400 });
}
