import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { configurationParameterGroupOrderValidator } from "~/modules/items";
import { updateConfigurationParameterGroupOrder } from "~/modules/items/items.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(
    configurationParameterGroupOrderValidator
  ).validate(formData);

  if (validation.error) {
    console.error(validation.error);
    return {
      success: false,
      error: "Invalid form data"
    };
  }

  const upsert = await updateConfigurationParameterGroupOrder({
    ...validation.data
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
