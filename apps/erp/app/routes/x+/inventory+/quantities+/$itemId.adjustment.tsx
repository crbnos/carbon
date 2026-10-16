// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { inventoryAdjustmentValidator } from "~/modules/inventory/inventory.models";
import { path, requestReferrer } from "~/utils/path";

// The adjustment form, and `acknowledged` once the user accepts the rule
// violations shown to them.
const adjustmentForm = inventoryAdjustmentValidator.and(
  z.object({ acknowledged: zfd.checkbox({ trueValue: "true" }) })
);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(adjustmentForm).request(args, {
    params: ["itemId"]
  });
  if ("invalid" in input) return input.invalid;
  // A form-only flag: the serial quantity cap has been checked.
  const { requiresSerialTracking: _serial, ...adjustment } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.adjustInventory(adjustment);
  // An error is toasted by the rule-violation fetcher that sent it.
  if (!result.data) return result;
  // A blocking rule: the violation modal reads these.
  if ("violations" in result.data) return result.data;
  throw redirect(
    requestReferrer(args.request) ?? path.to.inventoryItem(input.params.itemId)
  );
}
