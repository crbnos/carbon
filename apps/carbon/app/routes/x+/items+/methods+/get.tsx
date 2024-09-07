import { validationError, validator } from "@carbon/form";
import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { getSupabaseServiceRole } from "~/lib/supabase";
import { copyMakeMethod, getMethodValidator } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const serviceRole = getSupabaseServiceRole();

  const validation = await validator(getMethodValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const upsert = await copyMakeMethod(serviceRole, {
    ...validation.data,
    companyId,
    userId,
  });

  if (upsert.error) {
    return json({
      error: upsert.error ? "Failed to get method" : null,
    });
  }

  throw redirect(requestReferrer(request) ?? path.to.items);
}
