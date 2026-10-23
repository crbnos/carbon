// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

/** Drafts the job's sales invoice and opens it. */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["jobId"] });
  if ("invalid" in input) return input.invalid;
  const { jobId } = input.params;
  const api = await carbon(args.request);
  const result = await api.service.createServiceInvoice({
    serviceJobId: jobId
  });
  return respond(args.request, result).redirect(
    result.data
      ? path.to.salesInvoice(result.data.salesInvoiceId)
      : path.to.serviceJob(jobId),
    { message: "Created the job's invoice", onError: path.to.serviceJob(jobId) }
  );
}
