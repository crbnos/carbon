import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { json, redirect, type ActionFunctionArgs } from "@vercel/remix";
import {
  copyQuoteLine,
  getMethodValidator,
  upsertQuoteLineMethod,
  upsertQuoteMaterialMakeMethod,
} from "~/modules/sales";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const formData = await request.formData();
  const type = formData.get("type") as string;
  const configurationStr = formData.get("configuration") as string | null;
  const configuration = configurationStr ? JSON.parse(configurationStr) : undefined;

  const serviceRole = getCarbonServiceRole();
  if (type === "item") {
    const validation = await validator(getMethodValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const [quoteId, quoteLineId] = validation.data.targetId.split(":");
    const itemId = validation.data.sourceId;

    const lineMethodPayload: any = {
      itemId,
      quoteId,
      quoteLineId,
      companyId,
      userId,
    };
    
    // Only add configuration if it exists
    if (configuration !== undefined) {
      lineMethodPayload.configuration = configuration;
    }
    
    const lineMethod = await upsertQuoteLineMethod(serviceRole, lineMethodPayload);

    return json({
      error: lineMethod.error ? "Failed to get quote line method" : null,
    });
  }

  if (type === "quoteLine") {
    const validation = await validator(getMethodValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const copyLine = await copyQuoteLine(serviceRole, {
      ...validation.data,
      companyId,
      userId,
    });

    return json({
      error: copyLine.error ? "Failed to copy quote line" : null,
    });
  }

  if (type === "method") {
    const validation = await validator(getMethodValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const makeMethodPayload: any = {
      ...validation.data,
      companyId,
      userId,
    };
    
    // Only add configuration if it exists
    if (configuration !== undefined) {
      makeMethodPayload.configuration = configuration;
    }
    
    const makeMethod = await upsertQuoteMaterialMakeMethod(serviceRole, makeMethodPayload);

    if (makeMethod.error) {
      return json({
        error: makeMethod.error
          ? "Failed to insert quote material make method"
          : null,
      });
    }

    throw redirect(requestReferrer(request) ?? path.to.quotes);
  }

  return json({ error: "Invalid type" }, { status: 400 });
}
