// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { reimbursementPaymentValidator } from "~/modules/invoicing/invoicing.models";
import { path } from "~/utils/path";

/**
 * The "Pay expense" action: a disbursement to the employee, applied to the
 * reimbursement and posted (`invoicing.reimbursement.pay`).
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(reimbursementPaymentValidator).request(args, {
    params: ["reimbursementId"]
  });
  if ("invalid" in input) return input.invalid;
  const { reimbursementId } = input.params;
  const api = await carbon(args.request);
  const result = await api.invoicing.payReimbursement({
    ...input.data,
    reimbursementId
  });
  // A payout that was created but not applied or posted is finished on the
  // payment itself.
  if (result.data?.warning) {
    return respond(args.request, {
      error: { message: result.data.warning }
    }).redirect(path.to.payment(result.data.paymentId));
  }
  return respond(args.request, result).redirect(
    path.to.reimbursement(reimbursementId),
    { message: "Reimbursement paid" }
  );
}
