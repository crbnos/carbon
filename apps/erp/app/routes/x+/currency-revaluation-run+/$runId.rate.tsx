// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

const form = z.object({
  currencyCode: z.string().min(1, { message: "Currency is required" }),
  rate: zfd.numeric(z.number().positive({ message: "Rate must be positive" }))
});

/**
 * One currency's rate on a Draft run, saved from the rates grid cell. Answers
 * `{ error }` (a message or null): the cell reverts and toasts on error.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args, { params: ["runId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.accounting.updateCurrencyRevaluationRate({
    runId: input.params.runId,
    currencyCode: input.data.currencyCode,
    rate: input.data.rate
  });
  if (result.error) {
    return data(
      { error: result.error.message },
      { status: result.error.status }
    );
  }
  return { error: null };
}
