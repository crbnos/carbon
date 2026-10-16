// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["dispatchId", "eventId"]
  });
  if ("invalid" in input) return input.invalid;
  const { dispatchId, eventId } = input.params;
  const api = await carbon(args.request);
  const result = await api.resources.maintenanceEvent.delete({
    dispatchId,
    eventId
  });
  const to =
    requestReferrer(args.request) ?? path.to.maintenanceDispatch(dispatchId);
  // The timecard is gone either way; a failed reversal is the flash.
  if (result.data?.warning) {
    return redirectWithResult(
      args.request,
      { error: { message: result.data.warning } },
      { to }
    );
  }
  return redirectWithResult(args.request, result, {
    to,
    message: "Timecard removed successfully"
  });
}
