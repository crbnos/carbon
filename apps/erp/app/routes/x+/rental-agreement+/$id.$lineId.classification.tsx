// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { rentalAgreementLineClassificationValidator } from "~/modules/sales/sales.models";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    rentalAgreementLineClassificationValidator
  ).request(args, { params: ["id", "lineId"] });
  if ("invalid" in input) return input.invalid;
  const { id, lineId } = input.params;
  const api = await carbon(args.request);
  const result = await api.sales.classifyRentalUnit({
    ...input.data,
    rentalAgreementId: id,
    rentalAgreementLineId: lineId
  });
  return respond(args.request, result).redirect(
    result.error?.category === "notFound"
      ? (requestReferrer(args.request) ?? path.to.rentalAgreementDetails(id))
      : path.to.rentalAgreementLine(id, lineId),
    { message: `Classified as ${input.data.classification}` }
  );
}
