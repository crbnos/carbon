import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { json, redirect, type ActionFunctionArgs } from "@vercel/remix";
import {
  getMethodValidator,
  upsertMakeMethodFromQuoteLine,
  upsertMakeMethodFromQuoteMethod,
} from "~/modules/sales";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales",
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
    });

    return json({
      error: lineMethod.error
        ? "Failed to save quote method to make method"
        : null,
    });
  }

  if (type === "method") {
    const validation = await validator(getMethodValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const quoteMaterialId = validation.data.targetId;
    const itemId = validation.data.sourceId;

    const makeMethod = await upsertMakeMethodFromQuoteMethod(serviceRole, {
      quoteMaterialId,
      itemId,
      companyId,
      createdBy: userId,
    });

    if (makeMethod.error) {
      return json({
        error: makeMethod.error
          ? "Failed to save quote method to make method"
          : null,
      });
    }

    throw redirect(requestReferrer(request) ?? path.to.quotes);
  }

  return json({ error: "Invalid type" }, { status: 400 });
}
