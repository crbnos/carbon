import { validationError, validator } from "@carbon/remix-validated-form";
import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { getSupabaseServiceRole } from "~/lib/supabase";
import {
  getLineMethodValidator,
  getMethodValidator,
  upsertQuoteLineMethod,
  upsertQuoteMaterialMakeMethod,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const formData = await request.formData();
  const type = formData.get("type") as string;

  const serviceRole = getSupabaseServiceRole();
  if (type === "line") {
    const validation = await validator(getLineMethodValidator).validate(
      formData
    );
    if (validation.error) {
      return validationError(validation.error);
    }

    const lineMethod = await upsertQuoteLineMethod(serviceRole, {
      ...validation.data,
      companyId,
      userId,
    });

    return json({
      error: lineMethod.error ? "Failed to get quote line method" : null,
    });
  }

  if (type === "method") {
    const validation = await validator(getMethodValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const makeMethod = await upsertQuoteMaterialMakeMethod(serviceRole, {
      ...validation.data,
      companyId,
      createdBy: userId,
    });

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
