// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.purchasing.activateLease({ leaseId: id });
  // A refusal goes back where Activate was pressed (the setup Review step):
  // the lease page sends a Draft to its setup anyway.
  return respond(args.request, result).redirect(path.to.leaseDetails(id), {
    message: "Lease activated",
    onError: requestReferrer(args.request) ?? path.to.leaseSetup(id, "review")
  });
}
