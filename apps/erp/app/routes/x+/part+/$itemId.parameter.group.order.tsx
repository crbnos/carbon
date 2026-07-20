import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  configurationParameterGroupOrderValidator,
  updateConfigurationParameterGroupOrder
} from "~/modules/items";

const logger = getLogger("erp", "itemid-parameter-group-order");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(
    configurationParameterGroupOrderValidator
  ).validate(formData);

  if (validation.error) {
    logger.error(validation.error);
    return {
      success: false,
      error: "Invalid form data"
    };
  }

  const upsert = await updateConfigurationParameterGroupOrder(client, {
    ...validation.data
  });

  if (upsert.error) {
    logger.error(upsert.error);
    return {
      success: false,
      error: upsert.error.message
    };
  }

  return {
    success: true
  };
}
