// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { stockMovementCorrectionValidator } from "~/modules/inventory/inventory.models";
import { getStockMovementEffectiveQuantity } from "~/modules/inventory/inventory.service";

// The modal pre-fills its corrected-quantity field from this — the page's
// visible rows can miss off-page corrections (or descendants of a correction
// row), so the client never derives the effective quantity itself.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { ledgerId } = params;
  if (!ledgerId) throw new Error("Could not find ledgerId");

  const effective = await getStockMovementEffectiveQuantity(
    client,
    companyId,
    ledgerId
  );

  if (effective.error || !effective.data) {
    return { effectiveQuantity: null };
  }
  return { effectiveQuantity: effective.data.effectiveQuantity };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(stockMovementCorrectionValidator).request(
    args,
    { params: ["ledgerId"] }
  );
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  // Returned to the modal's fetcher: it toasts a refusal and stays open, and
  // closes itself on success. The table follows itemLedger through realtime.
  return api.inventory.correctStockMovement({
    ...input.data,
    itemLedgerId: input.params.ledgerId
  });
}
