// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { getPreferenceHeaders } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { salesInvoicePostValidator } from "~/modules/invoicing/invoicing.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesInvoicePostValidator).request(args, {
    params: ["invoiceId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.invoicing.postSalesInvoice({
    ...input.data,
    invoiceId: input.params.invoiceId,
    acknowledged: input.formData?.get("acknowledged") === "true",
    locale: getPreferenceHeaders(args.request).locale
  });
  // The violation modal reads `violations` off the response.
  if (result.data && "violations" in result.data) return result.data;
  return result;
}
