// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { path, requestReferrer } from "~/utils/path";

/**
 * Deliver on a part CLIN (spec section 10.4): opens the contract's Draft
 * delivery with this line on it, or makes one, then goes to it.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id", "lineId"] });
  if ("invalid" in input) return input.invalid;
  const { id, lineId } = input.params;
  const api = await carbon(args.request);
  const result = await api.sales.deliverContractLine({
    customerContractId: id,
    customerContractLineId: lineId
  });
  if (!result.data) {
    return respond(args.request, result).redirect(
      requestReferrer(args.request) ?? path.to.contractLine(id, lineId),
      { message: "" }
    );
  }
  throw redirect(path.to.shipmentDetails(result.data.shipmentId));
}
