// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { serviceJobFixedPriceValidator } from "~/modules/service/service.models";
import { path } from "~/utils/path";

/**
 * Drafts the job's sales invoice and opens it. A fixed price from the dialog
 * is saved on the job first, in the same transaction.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceJobFixedPriceValidator).request(args, {
    params: ["jobId"]
  });
  if ("invalid" in input) return input.invalid;
  const { jobId } = input.params;
  const api = await carbon(args.request);
  const result = await api.service.createServiceInvoice({
    serviceJobId: jobId,
    fixedPrice: input.data.fixedPrice
  });
  return respond(args.request, result).redirect(
    result.data
      ? path.to.salesInvoice(result.data.salesInvoiceId)
      : path.to.serviceJob(jobId),
    { message: "Created the job's invoice", onError: path.to.serviceJob(jobId) }
  );
}
