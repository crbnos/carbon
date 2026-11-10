// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { approvalDecisionValidator } from "@carbon/ee/approvals";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(approvalDecisionValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.items.decideChangeNoticeApproval({
    ...input.data,
    changeNoticeId: id
  });
  return respond(args.request, result).redirect(
    path.to.changeNoticeDetails(id),
    {
      message: `Approval request ${input.data.decision.toLowerCase()} successfully`
    }
  );
}
