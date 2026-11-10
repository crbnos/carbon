// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { salesOrderToJobValidator } from "~/modules/production/production.models";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesOrderToJobValidator).request(args, {
    params: ["orderId", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const { orderId, lineId } = input.params;
  const api = await carbon(args.request);
  // The job is attached to the order and line in the URL, never the form's.
  const result = await api.production.createSalesOrderLineJob({
    ...input.data,
    salesOrderId: orderId,
    salesOrderLineId: lineId,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
  if (result.error) {
    return respond(args.request, result).redirect(
      path.to.salesOrderLine(orderId, lineId)
    );
  }
  throw redirect(path.to.jobDetails(result.data.id));
}
