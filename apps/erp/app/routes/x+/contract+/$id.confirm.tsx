// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getLinkedStripeCustomerId } from "@carbon/stripe/send-sales-invoice.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { stripeCustomerChoiceValidator } from "~/modules/invoicing/invoicing.models";
import { getContract } from "~/modules/sales/sales.service";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "contract-confirm");

/** Read by the confirm modal when the contract sends its invoices via
 *  Stripe: whether the billing customer is linked to a Stripe customer.
 *  When it is not, the modal asks how to link one and the action links it
 *  before confirming. */
export async function loader({
  request,
  params
}: LoaderFunctionArgs): Promise<{ stripeCustomerLinked: boolean }> {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const contract = await getContract(client, id, companyId);
  if (contract.error || contract.data?.companyId !== companyId) {
    return { stripeCustomerLinked: false };
  }

  const billingCustomerId =
    contract.data.invoiceCustomerId ?? contract.data.customerId;
  if (!billingCustomerId) return { stripeCustomerLinked: false };

  try {
    const linked = await getLinkedStripeCustomerId(
      getCarbonServiceRole(),
      companyId,
      billingCustomerId
    );
    return { stripeCustomerLinked: !!linked };
  } catch (err) {
    logger.error("Failed to read the Stripe customer link", {
      companyId,
      customerContractId: id,
      billingCustomerId,
      error: err
    });
    return { stripeCustomerLinked: false };
  }
}

export async function action(args: ActionFunctionArgs) {
  // The Stripe customer to link, when the confirm modal asked for one.
  const input = await validator(stripeCustomerChoiceValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.sales.confirmContract({ id, ...input.data });
  // Straight to the contract page, never back to the referrer: from the
  // setup wizard that is a second redirect, and the contract layout does not
  // reload on a redirect that no longer carries the submission.
  return respond(args.request, result).redirect(
    result.data
      ? path.to.contractDetails(id)
      : (requestReferrer(args.request) ?? path.to.contractDetails(id)),
    { message: "Contract confirmed" }
  );
}
