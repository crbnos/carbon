// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { path } from "~/utils/path";

// The list page posts the period the user picked; it snaps to its month end.
const form = z.object({
  periodEnd: z.string().min(1, { message: "Period end is required" })
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.accounting.createCurrencyRevaluationRun({
    periodEnd: input.data.periodEnd
  });
  return respond(args.request, result).redirect(
    result.data
      ? path.to.currencyRevaluationRun(result.data.id)
      : path.to.currencyRevaluationRuns,
    { message: "Currency revaluation run created" }
  );
}
