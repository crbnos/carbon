// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { attachQuoteFile } from "~/modules/sales/sales.server";
import { path } from "~/utils/path";

// The drop posts the dragged file as JSON in one field.
const dropForm = z.object({
  payload: zfd.json(attachQuoteFile.input.omit({ quoteId: true }))
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(dropForm).request(args, {
    params: ["quoteId"]
  });
  if ("invalid" in input) return input.invalid;
  const { quoteId } = input.params;
  const api = await carbon(args.request);
  const result = await api.sales.attachQuoteFile({
    ...input.data.payload,
    quoteId
  });
  // Nothing reads a successful drop; a failure is shown on the quote.
  if (result.error) {
    return respond(args.request, result).redirect(path.to.quote(quoteId), {
      message: ""
    });
  }
  return result;
}
