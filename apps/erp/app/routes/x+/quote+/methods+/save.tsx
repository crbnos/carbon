import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  getMethodValidator,
  upsertMakeMethodFromQuoteLine,
  upsertMakeMethodFromQuoteMethod
} from "~/modules/sales";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const type = formData.get("type") as string;

  const serviceRole = getCarbonServiceRole();

  if (type === "item") {
    const validation = await validator(getMethodValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const [quoteId, quoteLineId] = validation.data.sourceId.split(":");
    const itemId = validation.data.targetId;

    const lineMethod = await upsertMakeMethodFromQuoteLine(serviceRole, {
      quoteId,
      quoteLineId,
      itemId,
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
      error: lineMethod.error
        ? "Failed to save quote method to make method"
        : null
    };
  }

  if (type === "method") {
    const validation = await validator(getMethodValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const makeMethod = await upsertMakeMethodFromQuoteMethod(serviceRole, {
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
          ? "Failed to save quote method to make method"
          : null
      };
    }

    throw redirect(requestReferrer(request) ?? path.to.quotes);
  }

  return data({ error: "Invalid type" }, { status: 400 });
}
