import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { createMappingService } from "@carbon/ee/accounting";
import type { ConnectCustomerInput } from "@carbon/stripe/connect.server";
import {
  findConnectCustomersByEmail,
  retrieveConnectCustomer
} from "@carbon/stripe/connect.server";
import {
  getCustomer,
  getCustomerLocation,
  getCustomerPayment,
  getCustomerTax
} from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import type { StripeCustomerSources } from "./stripe-customer.mapper";
import { buildStripeCustomerInput } from "./stripe-customer.mapper";

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

export const STRIPE_CONNECT_INTEGRATION = "stripe-connect";

// The pure Carbon → Stripe field mapping lives in its own module so it can be
// unit tested without this file's database and Stripe imports.
export { buildStripeCustomerInput };
export type { StripeCustomerSources };

/**
 * Gather every table a Stripe customer is assembled from.
 *
 * The billing address is NOT "the customer's first location" — Carbon points at
 * it explicitly through `customerPayment.invoiceCustomerLocationId`, which can
 * differ from the shipping location and can even belong to a different customer
 * (bill-to ≠ sold-to). Resolving it any other way bills the wrong address.
 *
 * `customerContactId` is scoped to `customerId = billingCustomerId` (not just
 * `companyId`) — `customerContact` carries no `companyId` column of its own, and
 * `billingCustomerId` is already validated against the invoice's `companyId` by
 * `getBillingCustomerId`. Without this, a caller who knows a contact UUID from
 * another tenant's customer could resolve that contact's email into this Stripe
 * lookup.
 */
export async function resolveStripeCustomerSources(
  serviceRole: ServiceRole,
  companyId: string,
  billingCustomerId: string,
  customerContactId: string
): Promise<StripeCustomerSources | null> {
  const [customer, contact, payment, customerTax] = await Promise.all([
    getCustomer(serviceRole, billingCustomerId, companyId),
    serviceRole
      .from("customerContact")
      .select(
        "*, contact(id, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes)"
      )
      .eq("id", customerContactId)
      .eq("customerId", billingCustomerId)
      .eq("companyId", companyId)
      .single(),
    getCustomerPayment(serviceRole, billingCustomerId, companyId),
    getCustomerTax(serviceRole, billingCustomerId, companyId)
  ]);

  if (!customer.data) return null;

  // `getCustomerLocation` (singular) is the only reader that selects
  // `address.countryCode`; the plural `getCustomerLocations` embeds
  // `country(alpha2, name)` instead and cannot supply Stripe's `address.country`.
  const billingLocationId = payment.data?.invoiceCustomerLocationId;
  const billingLocation = billingLocationId
    ? (await getCustomerLocation(serviceRole, billingLocationId, companyId))
        .data
    : null;

  return {
    customer: customer.data,
    contact: contact.data,
    billingLocation,
    customerTax: customerTax.data
  };
}

/** A Stripe customer, reduced to what the confirmation panel shows. */
export type StripeCustomerSummary = {
  id: string;
  name: string | null;
  email: string | null;
};

/**
 * What posting this invoice through Stripe would do to the connected account.
 *
 * Deliberately a closed union rather than a bag of optional fields: every state
 * demands a different question of the user, and the caller must handle all of
 * them before anything is created on a merchant's live account.
 */
export type StripeCustomerResolution =
  | { state: "unavailable"; message: string }
  | { state: "missing-email"; customerName: string }
  | { state: "linked"; customer: StripeCustomerSummary }
  | { state: "match-found"; matches: StripeCustomerSummary[] }
  | {
      state: "new";
      preview: {
        name: string;
        email: string;
        phone?: string;
        addressLines: string[];
        taxExempt: "none" | "exempt" | "reverse";
      };
    };

function toSummary(customer: {
  id: string;
  name?: string | null;
  email?: string | null;
}): StripeCustomerSummary {
  return {
    id: customer.id,
    name: customer.name ?? null,
    email: customer.email ?? null
  };
}

/**
 * The connected account this company bills through, or null if the
 * integration is not set up or onboarding is not far enough along to accept
 * charges yet.
 *
 * `active` alone is not enough to gate on: the connect callback sets it
 * `true` as soon as a Stripe account exists, before onboarding (and
 * `chargesEnabled`) is complete. Gating only on `active` let mid-onboarding
 * companies see the Stripe send option, get their invoice Posted, and then
 * fail the actual Stripe send.
 */
export async function getStripeConnectAccountId(
  serviceRole: ServiceRole,
  companyId: string
): Promise<string | null> {
  const integration = await serviceRole
    .from("companyIntegration")
    .select("active, metadata")
    .eq("id", STRIPE_CONNECT_INTEGRATION)
    .eq("companyId", companyId)
    .maybeSingle();

  if (!integration.data?.active) return null;

  const metadata = integration.data.metadata as
    | Record<string, unknown>
    | undefined;
  if (metadata?.chargesEnabled !== true) return null;

  return (metadata?.stripeAccountId as string | undefined) ?? null;
}

/**
 * Who gets billed for this invoice.
 *
 * `invoiceCustomerId` is the bill-to and takes precedence — it is set when the
 * customer receiving the goods is not the one paying for them.
 */
export async function getBillingCustomerId(
  serviceRole: ServiceRole,
  invoiceId: string,
  companyId: string
): Promise<string | null> {
  const invoice = await serviceRole
    .from("salesInvoice")
    .select("customerId, invoiceCustomerId")
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (!invoice.data) return null;
  return invoice.data.invoiceCustomerId ?? invoice.data.customerId ?? null;
}

/**
 * Decide what would happen to the connected account, without changing anything.
 *
 * Read-only by design: both the modal (to ask the user) and the post action (to
 * check the answer it got back) call this. Running the same resolution on both
 * sides is what stops a client from claiming "just link me to cus_X" for a
 * customer that does not exist, belongs to another account, or was never offered.
 */
export async function resolveStripeCustomer({
  serviceRole,
  companyId,
  invoiceId,
  customerContactId,
  emailOverride
}: {
  serviceRole: ServiceRole;
  companyId: string;
  invoiceId: string;
  customerContactId: string;
  emailOverride?: string;
}): Promise<
  | { resolution: StripeCustomerResolution; sources: null }
  | {
      resolution: StripeCustomerResolution;
      sources: StripeCustomerSources;
      stripeAccountId: string;
      billingCustomerId: string;
      input: ConnectCustomerInput | null;
    }
> {
  const stripeAccountId = await getStripeConnectAccountId(
    serviceRole,
    companyId
  );
  if (!stripeAccountId) {
    return {
      resolution: {
        state: "unavailable",
        message: "Stripe Connect is not connected for this company"
      },
      sources: null
    };
  }

  const billingCustomerId = await getBillingCustomerId(
    serviceRole,
    invoiceId,
    companyId
  );
  if (!billingCustomerId) {
    return {
      resolution: {
        state: "unavailable",
        message: "this invoice has no customer to bill"
      },
      sources: null
    };
  }

  const sources = await resolveStripeCustomerSources(
    serviceRole,
    companyId,
    billingCustomerId,
    customerContactId
  );
  if (!sources) {
    return {
      resolution: {
        state: "unavailable",
        message: "the customer could not be loaded"
      },
      sources: null
    };
  }

  const found = { stripeAccountId, billingCustomerId, sources };
  const input = buildStripeCustomerInput(sources, emailOverride);

  // No email means no invoice can be sent, so ask for one before looking
  // anything up — an email is also the only key we can match Stripe on.
  if (!input) {
    return {
      ...found,
      input: null,
      resolution: {
        state: "missing-email",
        customerName: sources.customer.name ?? ""
      }
    };
  }

  const mappingService = createMappingService(getDatabaseClient(), companyId);
  const mapping = await mappingService.getByEntity(
    "customer",
    billingCustomerId,
    STRIPE_CONNECT_INTEGRATION
  );

  if (mapping?.externalId) {
    const existing = await retrieveConnectCustomer(
      stripeAccountId,
      mapping.externalId
    );
    // A mapping whose customer was deleted in the Stripe dashboard falls
    // through to the search below rather than failing the post.
    if (existing) {
      return {
        ...found,
        input,
        resolution: { state: "linked", customer: toSummary(existing) }
      };
    }
  }

  const matches = await findConnectCustomersByEmail(
    stripeAccountId,
    input.email
  );

  if (matches.length) {
    return {
      ...found,
      input,
      resolution: { state: "match-found", matches: matches.map(toSummary) }
    };
  }

  return {
    ...found,
    input,
    resolution: {
      state: "new",
      preview: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        addressLines: [
          input.address?.line1,
          input.address?.line2,
          [
            input.address?.city,
            input.address?.state,
            input.address?.postal_code
          ]
            .filter(Boolean)
            .join(", "),
          input.address?.country
        ].filter((line): line is string => Boolean(line)),
        taxExempt: input.taxExempt ?? "none"
      }
    }
  };
}
