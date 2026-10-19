// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { RUN_PAGES } from "~/modules/accounting/ui/RevenueRecognition/runPages";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["runId"] });
  if ("invalid" in input) return input.invalid;
  const { runId } = input.params;
  const api = await carbon(args.request);
  const result = await api.accounting.recalculateRevenueRecognitionRun({
    runId
  });
  const run = result.data;
  // A run left with nothing due is deleted; go back to its own type's list.
  return respond(args.request, result).redirect(
    run?.deleted
      ? RUN_PAGES[run.type].listPath
      : path.to.revenueRecognitionRun(runId),
    {
      message: !run
        ? undefined
        : run.deleted
          ? `Nothing is due by this run's period end any more, so ${run.readableId} was deleted`
          : run.changed
            ? `Recalculated ${run.readableId}: ${run.lineCount} lines`
            : `${run.readableId} is already up to date`
    }
  );
}
