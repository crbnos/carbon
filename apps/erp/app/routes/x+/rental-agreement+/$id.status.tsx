// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, respond } from "~/modules/carbon.server";
import { setRentalAgreementStatus } from "~/modules/sales/sales.server";
import { path } from "~/utils/path";

// Close or cancel: the server function owns the checks.
const statusForm = setRentalAgreementStatus.input.pick({ intent: true });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(statusForm).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const { intent } = input.data;
  const api = await carbon(args.request);
  const result = await api.sales.rentalAgreement.setStatus({ id, intent });
  return respond(args.request, result).redirect(
    result.error?.category === "notFound"
      ? path.to.rentalAgreements
      : path.to.rentalAgreementDetails(id),
    {
      message:
        intent === "close"
          ? "Rental agreement closed"
          : "Rental agreement cancelled"
    }
  );
}
