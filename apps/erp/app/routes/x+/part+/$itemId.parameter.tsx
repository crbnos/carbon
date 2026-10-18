// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { configurationParameterValidator } from "~/modules/items/items.models";
import { upsertConfigurationParameter } from "~/modules/items/items.service";

const logger = getLogger("erp", "itemid-parameter");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await authorize(request, {
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
