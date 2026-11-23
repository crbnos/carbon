// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["depreciationRunId"]
  });
  if ("invalid" in input) return input.invalid;
  const { depreciationRunId } = input.params;
  const api = await carbon(args.request);
  const result = await api.accounting.recalculateDepreciationRun({
    depreciationRunId
  });
  const run = result.data;
  return respond(args.request, result).redirect(
    run?.deleted
      ? path.to.depreciationRuns
      : path.to.depreciationRun(depreciationRunId),
    {
      message: !run
        ? undefined
        : run.deleted
          ? `Nothing is left to depreciate for this period, so ${run.readableId} was deleted`
          : run.changed
            ? `Recalculated ${run.readableId}: ${run.lineCount} lines`
            : `${run.readableId} is already up to date`
    }
  );
}
