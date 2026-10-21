// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { existingDraftRunId } from "~/modules/accounting/accounting.service";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["runId"] });
  if ("invalid" in input) return input.invalid;
  const { runId } = input.params;
  const api = await carbon(args.request);
  const result = await api.accounting.repeatRevenueRecognitionRun({ runId });
  // A Draft already holding the next month opens instead.
  const draftRunId = existingDraftRunId(result.error);
  return respond(args.request, result).redirect(
    path.to.revenueRecognitionRun(result.data?.id ?? draftRunId ?? runId),
    { message: result.data ? `${result.data.readableId} created` : undefined }
  );
}
