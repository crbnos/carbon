import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  configurationParameterValidator,
  upsertConfigurationParameter
} from "~/modules/items";

const logger = getLogger("erp", "itemid-parameter");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(configurationParameterValidator).validate(
    formData
  );

  if (validation.error) {
    return {
      success: false,
      error: "Invalid form data"
    };
  }

  const { listOptions, ...d } = validation.data;

  const upsert = await upsertConfigurationParameter(client, {
    ...d,
    listOptions: d.dataType === "list" ? listOptions : undefined,
    companyId,
    userId
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
