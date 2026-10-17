// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { path } from "~/utils/path";

// The list page posts the period the user picked; a bare POST runs the month
// after the last run.
const form = z.object({ periodEnd: z.string().optional() });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.accounting.createDepreciationRun({
    periodEnd: input.data.periodEnd || undefined
  });
  return respond(args.request, result).redirect(
    result.data
      ? path.to.depreciationRun(result.data.id)
      : path.to.depreciationRuns,
    { message: "Depreciation run created" }
  );
}
