// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import type { StripeCustomerResolution } from "~/modules/invoicing/stripe-customer.server";
import { resolveStripeCustomerForBilling } from "~/modules/invoicing/stripe-customer.server";

const logger = getLogger("stripe-connect");

/**
 * What linking this billing customer to Stripe would do to the connected
 * account — the by-customer twin of `stripe-connect.customer.$invoiceId`, for
 * screens that know who is billed but have no invoice yet (the contract
 * confirm modal).
 *
 * Read-only — the action that links re-runs the same resolution before it
 * acts, so nothing here is load-bearing for correctness.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const { customerId } = params;
  if (!customerId) {
    return Response.json({
      state: "unavailable",
      message: "Could not find customerId"
    } satisfies StripeCustomerResolution);
  }

  const serviceRole = getCarbonServiceRole();

  // The service role bypasses RLS: refuse a customer of another company before
  // anything is read from it or looked up on Stripe.
  const customer = await serviceRole
    .from("customer")
    .select("id")
    .eq("id", customerId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (customer.error) {
    logger.error("Failed to load the customer for a Stripe lookup", {
      companyId,
      customerId,
      error: customer.error
    });
  }
  if (!customer.data) {
    return Response.json({
      state: "unavailable",
      message: "the customer could not be loaded"
    } satisfies StripeCustomerResolution);
  }

  const url = new URL(request.url);

  try {
    const { resolution } = await resolveStripeCustomerForBilling({
      serviceRole,
      companyId,
      billingCustomerId: customerId,
      // Optional: a contract need not name an invoice contact.
      customerContactId: url.searchParams.get("contact"),
      // Set once the user supplies an address the contact lacks, so the match
      // search runs against it too.
      emailOverride: url.searchParams.get("email") ?? undefined
    });

    return Response.json(resolution);
  } catch (err) {
    logger.error("Failed to resolve Stripe customer", {
      companyId,
      customerId,
      error: err
    });
    // A Stripe outage must not present as "ready to create" — the modal keeps
    // its submit disabled on `unavailable`.
    return Response.json({
      state: "unavailable",
      message: "could not reach Stripe to check for an existing customer"
    } satisfies StripeCustomerResolution);
  }
}
