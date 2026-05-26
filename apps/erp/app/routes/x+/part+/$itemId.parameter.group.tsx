import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { configurationParameterGroupValidator } from "~/modules/items";
import { upsertConfigurationParameterGroup } from "~/modules/items/items.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(
    configurationParameterGroupValidator
  ).validate(formData);

  if (validation.error) {
    return {
      success: false,
      error: "Invalid form data"
    };
  }

  const upsert = await upsertConfigurationParameterGroup({
    ...validation.data,
    itemId,
    companyId
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
