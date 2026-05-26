import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { configurationRuleValidator } from "~/modules/items";
import { upsertConfigurationRule } from "~/modules/items/items.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(configurationRuleValidator).validate(
    formData
  );

  if (validation.error) {
    return {
      success: false,
      error: "Invalid form data"
    };
  }

  const upsert = await upsertConfigurationRule({
    ...validation.data,
    itemId,
    companyId,
    updatedBy: userId
  });

  if (upsert.error) {
    console.error(upsert.error);
    return {
      success: false,
      error: upsert.error.message
    };
  }

  return {
    success: true
  };
}
