// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.sales.activateRentalAgreement({ id });
  // From the setup wizard (Draft only), straight to the agreement's page.
  const referrer = requestReferrer(args.request);
  return respond(args.request, result).redirect(
    result.error?.category === "notFound"
      ? path.to.rentalAgreements
      : referrer && (result.error || !referrer.includes("/setup/"))
        ? referrer
        : path.to.rentalAgreementDetails(id),
    { message: "Rental agreement activated" }
  );
}
