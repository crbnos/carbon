// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { getPreferenceHeaders } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  salesConfirmValidator,
  selectedLinesValidator
} from "~/modules/sales/sales.models";
import { path } from "~/utils/path";

// The drawer posts the chosen lines as JSON beside the email choices.
const convertForm = salesConfirmValidator.safeExtend({
  selectedLines: zfd.json(selectedLinesValidator),
  poNumber: zfd.text(z.string().optional())
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(convertForm).request(args, {
    params: ["quoteId"]
  });
  if ("invalid" in input) return input.invalid;
  const { quoteId } = input.params;
  const { poNumber, ...form } = input.data;
  const api = await carbon(args.request);
  const result = await api.sales.convertQuote({
    ...form,
    quoteId,
    purchaseOrderNumber: poNumber,
    acknowledged: input.formData?.get("acknowledged") === "true",
    locale: getPreferenceHeaders(args.request).locale
  });
  if (result.data && "violations" in result.data) return result.data;
  return respond(args.request, result).redirect(
    result.data
      ? path.to.salesOrder(result.data.salesOrderId)
      : path.to.quoteDetails(quoteId),
    { message: "Successfully converted quote to order" }
  );
}
