// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { releaseBatches } from "~/modules/production/production.server";

// The batches table's bulk Release: no dialog, so a batch with a purchase
// order choice to make is refused and named.
const selection = releaseBatches.input.pick({ batchIds: true });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(selection).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.production.releaseBatches(input.data);
}
