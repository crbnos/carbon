import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import {
  configurationParameterGroupOrderValidator,
  updateConfigurationParameterGroupOrder,
} from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(
    configurationParameterGroupOrderValidator
  ).validate(formData);

  if (validation.error) {
    console.error(validation.error);
    return json({
      success: false,
      error: "Invalid form data",
    });
  }

  const upsert = await updateConfigurationParameterGroupOrder(client, {
    ...validation.data,
  });

  if (upsert.error) {
    console.error(upsert.error);
    return json({
      success: false,
      error: upsert.error.message,
    });
  }

  return json({
    success: true,
  });
}
