// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLinkedStripeCustomerId } from "@carbon/stripe/send-sales-invoice.server";
import { datetime, getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { getContract } from "~/modules/sales";
import { runContractAction } from "~/modules/sales/sales.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

/** Read by the confirm modal when the contract sends its invoices via
 *  Stripe: whether the billing customer is linked to a Stripe customer,
 *  without which the contract cannot be confirmed. Only checks the link;
 *  a customer is linked when an invoice is posted with Send via Stripe. */
export async function loader({
  request,
  params
}: LoaderFunctionArgs): Promise<{ stripeCustomerLinked: boolean }> {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const contract = await getContract(client, id);
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
  } catch {
    return { stripeCustomerLinked: false };
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const contract = await getContract(client, id);
  if (contract.error || contract.data?.companyId !== companyId) {
    throw redirect(
      path.to.contracts,
      await flash(request, error(contract.error, "Contract not found"))
    );
  }

  if (contract.data.status !== "Draft") {
    throw redirect(
      requestReferrer(request) ?? path.to.contractDetails(id),
      await flash(
        request,
        error(null, "Only a Draft contract can be confirmed")
      )
    );
  }

  // A contract whose invoices post drafts sales invoices that post on their
  // own, so confirming it needs the invoicing permission too (spec decision
  // 29).
  if (contract.data.effectiveInvoiceAutomation !== "Draft Only") {
    await requirePermissions(request, {
      update: "sales",
      create: "invoicing"
    });
  }

  // Checks the lines, fixes the invoice schedule and, for Post and Send via
  // Stripe, refuses a billing customer with no Stripe customer linked — one
  // transaction in the server function.
  const asOf = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const result = await runContractAction(
    { client, db: getDatabaseClient(), companyId, userId },
    { type: "confirm", customerContractId: id, asOf }
  );

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.contractDetails(id),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to confirm the contract")
        )
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.contractDetails(id),
    await flash(request, success("Contract confirmed"))
  );
}
