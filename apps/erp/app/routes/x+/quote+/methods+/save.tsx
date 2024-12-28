import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { json, redirect, type ActionFunctionArgs } from "@vercel/remix";
import {
  getLineMethodValidator,
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
  if (type === "line") {
    const validation = await validator(getLineMethodValidator).validate(
      formData
    );
    if (validation.error) {
      return validationError(validation.error);
    }

    const lineMethod = await upsertMakeMethodFromQuoteLine(serviceRole, {
      ...validation.data,
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

    const makeMethod = await upsertMakeMethodFromQuoteMethod(serviceRole, {
      ...validation.data,
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
