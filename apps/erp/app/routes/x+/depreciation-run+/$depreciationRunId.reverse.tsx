// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, respond } from "~/modules/carbon.server";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["depreciationRunId"]
  });
  if ("invalid" in input) return input.invalid;
  const { depreciationRunId } = input.params;
  const api = await carbon(args.request);
  const result = await api.accounting.depreciationRun.reverse({
    depreciationRunId
  });
  return respond(args.request, result).redirect(
    path.to.depreciationRun(depreciationRunId),
    {
      message: result.data
        ? `Reversed ${result.data.readableId}. It is a draft again.`
        : undefined
    }
  );
}
