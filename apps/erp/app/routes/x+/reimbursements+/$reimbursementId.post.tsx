// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["reimbursementId"]
  });
  if ("invalid" in input) return input.invalid;
  const reimbursementId = input.params.reimbursementId;
  const api = await carbon(args.request);
  const result = await api.invoicing.postReimbursement({
    reimbursementId: reimbursementId
  });
  return respond(args.request, result).redirect(
    path.to.reimbursement(reimbursementId),
    { message: "Reimbursement posted" }
  );
}
