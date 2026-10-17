// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["runId"] });
  if ("invalid" in input) return input.invalid;
  const { runId } = input.params;
  const api = await carbon(args.request);
  const result = await api.accounting.reverseRevenueRecognitionRun({ runId });
  const run = result.data;
  // A revenue run that held only rental rows gives them to the lease run.
  return respond(args.request, result).redirect(
    run?.deleted ? path.to.leaseRuns : path.to.revenueRecognitionRun(runId),
    {
      message: !run
        ? undefined
        : run.deleted
          ? `Reversed ${run.readableId}. Its rows now belong to the next lease run.`
          : `Reversed ${run.readableId}. It is a draft again.`
    }
  );
}
