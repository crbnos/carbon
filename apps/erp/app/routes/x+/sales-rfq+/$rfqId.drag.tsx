// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { salesRfqDragValidator } from "~/modules/sales/sales.models";
import { path } from "~/utils/path";

// The drop posts the dragged file as JSON in one field.
const dropForm = z.object({ payload: zfd.json(salesRfqDragValidator) });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(dropForm).request(args, {
    params: ["rfqId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.sales.attachSalesRfqFile(input.data.payload);
  // Nothing reads a successful drop; a failure is shown on the RFQ.
  if (result.error) {
    return respond(args.request, result).redirect(
      path.to.salesRfqDetails(input.params.rfqId),
      { message: "" }
    );
  }
  return result;
}
