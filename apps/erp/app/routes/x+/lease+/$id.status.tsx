// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { path } from "~/utils/path";

// The only status change a lease takes by hand: cancelling an Active one.
const form = z.object({ intent: z.literal("cancel") });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.purchasing.cancelLease({ leaseId: id });
  return respond(args.request, result).redirect(path.to.leaseDetails(id), {
    message: "Lease cancelled"
  });
}
