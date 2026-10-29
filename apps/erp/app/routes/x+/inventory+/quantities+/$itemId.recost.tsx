// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { serialUnitRecostValidator } from "~/modules/inventory/inventory.models";

// Recosting puts a number of the user's own on the books: the operation
// takes accounting update.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(serialUnitRecostValidator).request(args, {
    params: ["itemId"]
  });
  if ("invalid" in input) return input.invalid;
  const { offsetAccountId, ...recost } = input.data;
  const api = await carbon(args.request);
  return api.inventory.recostSerialUnit({
    ...recost,
    offsetAccountId: offsetAccountId || null
  });
}
