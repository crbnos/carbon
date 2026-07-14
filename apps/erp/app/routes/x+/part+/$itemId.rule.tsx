import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  configurationRuleValidator,
  upsertConfigurationRule
} from "~/modules/items";

const logger = getLogger("erp", "itemid-rule");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  const upsert = await upsertConfigurationRule(client, {
    ...validation.data,
    itemId,
    companyId,
    updatedBy: userId
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
