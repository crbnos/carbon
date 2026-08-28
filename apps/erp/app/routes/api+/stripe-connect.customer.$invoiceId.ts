import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import type { StripeCustomerResolution } from "~/modules/invoicing/stripe-customer.server";
import { resolveStripeCustomer } from "~/modules/invoicing/stripe-customer.server";

const logger = getLogger("stripe-connect");

export type { StripeCustomerResolution };

/**
 * What posting this invoice through Stripe would do to the connected account.
 *
 * Read-only — the post action re-runs the same resolution before it acts, so
 * nothing here is load-bearing for correctness; it exists so the user can see
 * the decision before making it.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) {
    return Response.json({
      state: "unavailable",
      message: "Could not find invoiceId"
    } satisfies StripeCustomerResolution);
  }

  const url = new URL(request.url);
  const customerContactId = url.searchParams.get("contact");
  if (!customerContactId) {
    return Response.json({
      state: "unavailable",
      message: "a customer contact is required"
    } satisfies StripeCustomerResolution);
  }

  try {
    const { resolution } = await resolveStripeCustomer({
      serviceRole: getCarbonServiceRole(),
      companyId,
      invoiceId,
      customerContactId,
      // Set once the user supplies an address for a contact that had none, so
      // the match search runs against it too — otherwise a customer Stripe
      // already has under that email would be duplicated.
      emailOverride: url.searchParams.get("email") ?? undefined
    });

    return Response.json(resolution);
  } catch (err) {
    logger.error("Failed to resolve Stripe customer", { error: err });
    // A Stripe outage must not present as "ready to create" — the modal keeps
    // the submit disabled on `unavailable`.
    return Response.json({
      state: "unavailable",
      message: "could not reach Stripe to check for an existing customer"
    } satisfies StripeCustomerResolution);
  }
}
