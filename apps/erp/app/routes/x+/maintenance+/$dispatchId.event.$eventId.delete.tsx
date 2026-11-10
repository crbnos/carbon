// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["dispatchId", "eventId"]
  });
  if ("invalid" in input) return input.invalid;
  const { dispatchId, eventId } = input.params;
  const api = await carbon(args.request);
  const result = await api.resources.deleteMaintenanceEvent({
    dispatchId,
    eventId
  });
  const to =
    requestReferrer(args.request) ?? path.to.maintenanceDispatch(dispatchId);
  // The timecard is gone either way; a failed reversal is the flash.
  if (result.data?.warning) {
    return respond(args.request, {
      error: { message: result.data.warning }
    }).redirect(to);
  }
  return respond(args.request, result).redirect(to, {
    message: "Timecard removed successfully"
  });
}
