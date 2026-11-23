// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { trackedEntityExpiryValidator } from "~/modules/inventory/inventory.models";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(trackedEntityExpiryValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { trackedEntityId, expirationDate, reason } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.updateTrackedEntityExpiry({
    trackedEntityId,
    // Empty clears the date.
    expirationDate: expirationDate || null,
    reason
  });
  return respond(args.request, result).redirect(
    requestReferrer(args.request) ?? path.to.trackedEntities,
    { message: "Expiration date updated" }
  );
}
