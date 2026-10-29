// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { rentalAgreementReleaseValidator } from "~/modules/sales/sales.models";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(rentalAgreementReleaseValidator).request(args, {
    params: ["id", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const { id, lineId } = input.params;
  const api = await carbon(args.request);
  // The line is the URL's; the server function re-reads it under the
  // agreement and company.
  const result = await api.sales.releaseRentalUnit({
    rentalAgreementId: id,
    rentalAgreementLineId: lineId,
    returnedAt: input.data.returnedAt
  });
  return respond(args.request, result).redirect(
    requestReferrer(args.request) ?? path.to.rentalAgreementDetails(id),
    { message: "Unit released" }
  );
}
