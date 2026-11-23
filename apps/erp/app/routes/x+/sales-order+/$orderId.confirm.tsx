// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { getPreferenceHeaders } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { salesConfirmValidator } from "~/modules/sales/sales.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesConfirmValidator).request(args, {
    params: ["orderId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.sales.confirmSalesOrder({
    ...input.data,
    salesOrderId: input.params.orderId,
    acknowledged: input.formData?.get("acknowledged") === "true",
    locale: getPreferenceHeaders(args.request).locale
  });
  // The violation modal reads `violations` off the response.
  if (result.data && "violations" in result.data) return result.data;
  return result;
}
