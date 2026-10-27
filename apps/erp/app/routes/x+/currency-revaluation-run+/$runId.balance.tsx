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
  lineId: z.string().min(1, { message: "Line is required" }),
  openAmount: zfd.numeric(z.number({ message: "Enter the statement balance" }))
});

/**
 * One account's statement balance on a Draft run, saved from the balances
 * grid cell. Answers `{ error }` (a message or null): the cell reverts and
 * toasts on error.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args, { params: ["runId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.accounting.updateCurrencyRevaluationBalance({
    runId: input.params.runId,
    lineId: input.data.lineId,
    openAmount: input.data.openAmount
  });
  if (result.error) {
    return data(
      { error: result.error.message },
      { status: result.error.status }
    );
  }
  return { error: null };
}
