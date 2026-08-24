import type { ConnectCustomerInput } from "@carbon/stripe/connect.server";
// Type-only imports on purpose: they are erased at build, so this module stays
// free of the `~/modules/sales` barrel. Importing it for real would transitively
// pull `@carbon/glossary`'s Lingui macros, which throw outside a configured i18n
// runtime and take plain unit tests of this mapper down with them.
import type {
  getCustomer,
  getCustomerContact,
  getCustomerLocation,
  getCustomerTax
} from "~/modules/sales";

/**
 * Stripe caps a metadata value at 500 characters and rejects the whole request
 * over it — a long tag list would otherwise fail the customer create rather
 * than being quietly trimmed.
 */
const METADATA_VALUE_LIMIT = 500;

export type StripeCustomerSources = {
  customer: NonNullable<Awaited<ReturnType<typeof getCustomer>>["data"]>;
  contact: Awaited<ReturnType<typeof getCustomerContact>>["data"];
  billingLocation: Awaited<ReturnType<typeof getCustomerLocation>>["data"];
  customerTax: Awaited<ReturnType<typeof getCustomerTax>>["data"];
};

function clampMetadata(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, METADATA_VALUE_LIMIT);
}

/**
 * Carbon's `taxExempt` + `taxExemptionReason` → Stripe's single `tax_exempt`.
 *
 * An export sale is zero-rated with the liability shifted to the buyer, which
 * is Stripe's `"reverse"` — not a blanket exemption. Every other Carbon reason
 * (Resale, Government, Nonprofit, Agriculture, Industrial, Medical,
 * Educational, Religious, Other) is an ordinary `"exempt"`.
 */
export function toStripeTaxExempt(
  taxExempt: boolean | null | undefined,
  reason: string | null | undefined
): "none" | "exempt" | "reverse" {
  if (!taxExempt) return "none";
  return reason === "Export" ? "reverse" : "exempt";
}

/**
 * Flatten Carbon's customer graph into Stripe's single-object shape.
 *
 * Pure so the mapping can be tested without a database or a Stripe account.
 * `emailOverride` carries an address the user typed into the post modal for a
 * contact that had none — it has already been written back to `contact.email`
 * by then, but the row in hand is the pre-update read.
 *
 * Returns null when the customer cannot be billed at all (no name, or no email
 * for Stripe to send the invoice to), so the caller has one thing to check.
 */
export function buildStripeCustomerInput(
  sources: StripeCustomerSources,
  emailOverride?: string
): ConnectCustomerInput | null {
  const { customer, contact, billingLocation, customerTax } = sources;

  if (!customer.name) return null;

  const email = emailOverride ?? contact?.contact?.email ?? undefined;
  if (!email) return null;

  // `customerContact` is the join row — the person's details hang off the
  // embedded `contact`, never off the join row itself.
  const person = contact?.contact;
  // The `customers` view derives `phone` from the primary contact already; the
  // selected contact's own numbers are the better answer when it does not.
  const phone =
    customer.phone ?? person?.workPhone ?? person?.mobilePhone ?? undefined;

  // Address fields likewise hang off the embedded `address`, not the
  // `customerLocation` join row. `countryCode` is ISO 3166-1 alpha-2 by
  // construction — it is a foreign key to `country("alpha2")` — so it needs no
  // normalization before Stripe sees it.
  const address = billingLocation?.address
    ? {
        line1: billingLocation.address.addressLine1 ?? undefined,
        line2: billingLocation.address.addressLine2 ?? undefined,
        city: billingLocation.address.city ?? undefined,
        state: billingLocation.address.stateProvince ?? undefined,
        postal_code: billingLocation.address.postalCode ?? undefined,
        country: billingLocation.address.countryCode ?? undefined
      }
    : undefined;

  return {
    name: customer.name,
    email,
    phone,
    website: customer.website,
    readableId: customer.readableId,
    address,
    taxExempt: toStripeTaxExempt(
      customerTax?.taxExempt,
      customerTax?.taxExemptionReason
    ),
    metadata: {
      carbon_customer_id: clampMetadata(customer.id),
      carbon_company_id: clampMetadata(customer.companyId),
      carbon_readable_id: clampMetadata(customer.readableId),
      carbon_status: clampMetadata(customer.status) || "unknown",
      carbon_type: clampMetadata(customer.type) || "unknown",
      // A fraction in [0, 1], not a percent. Carried for traceability only —
      // Stripe computes tax per line item from the invoice's own rates.
      carbon_tax_percent: (customer.taxPercent ?? 0).toString(),
      carbon_tags: clampMetadata(customer.tags?.join(",") ?? "")
    }
  };
}
