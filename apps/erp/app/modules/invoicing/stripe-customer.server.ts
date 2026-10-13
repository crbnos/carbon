// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { createMappingService } from "@carbon/ee/accounting";
import type { ConnectCustomerInput } from "@carbon/stripe/connect.server";
import {
  findConnectCustomersByEmail,
  retrieveConnectCustomer,
  upsertConnectCustomer
} from "@carbon/stripe/connect.server";
import {
  getStripeConnectAccountId,
  STRIPE_CONNECT_INTEGRATION
} from "@carbon/stripe/send-sales-invoice.server";
import {
  getCustomer,
  getCustomerContact,
  getCustomerLocation,
  getCustomerPayment,
  getCustomerTax,
  updateCustomerContact
} from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import type { stripeCustomerActions } from "./invoicing.models";
import type { StripeCustomerSources } from "./stripe-customer.mapper";
import { buildStripeCustomerInput } from "./stripe-customer.mapper";

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

// The connected-account lookup lives in @carbon/stripe so invoice automation
// (in @carbon/jobs) reads it the same way the ERP does.
export { getStripeConnectAccountId, STRIPE_CONNECT_INTEGRATION };

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
 * lookup. With no contact (a contract need not name one) the email can only
 * come from the caller's `emailOverride`.
 */
export async function resolveStripeCustomerSources(
  serviceRole: ServiceRole,
  companyId: string,
  billingCustomerId: string,
  customerContactId: string | null
): Promise<StripeCustomerSources | null> {
  const [customer, contact, payment, customerTax] = await Promise.all([
    getCustomer(serviceRole, billingCustomerId, companyId),
    customerContactId
      ? serviceRole
          .from("customerContact")
          .select(
            "*, contact(id, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes)"
          )
          .eq("id", customerContactId)
          .eq("customerId", billingCustomerId)
          .eq("companyId", companyId)
          .single()
      : { data: null },
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
 *
 * Starts from an INVOICE: the billed customer is its bill-to. A contract (or
 * anything else that already knows who it bills) uses
 * `resolveStripeCustomerForBilling` directly.
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
}): Promise<StripeCustomerResolutionResult> {
  const stripeAccountId = await getStripeConnectAccountId(
    serviceRole,
    companyId
  );
  if (!stripeAccountId) return notConnected();

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

  return resolveForAccount({
    serviceRole,
    companyId,
    stripeAccountId,
    billingCustomerId,
    customerContactId,
    emailOverride
  });
}

type StripeCustomerResolutionResult =
  | { resolution: StripeCustomerResolution; sources: null }
  | {
      resolution: StripeCustomerResolution;
      sources: StripeCustomerSources;
      stripeAccountId: string;
      billingCustomerId: string;
      input: ConnectCustomerInput | null;
    };

function notConnected(): StripeCustomerResolutionResult {
  return {
    resolution: {
      state: "unavailable",
      message: "Stripe Connect is not connected for this company"
    },
    sources: null
  };
}

/**
 * `resolveStripeCustomer`, starting from the customer who is billed rather
 * than from an invoice. `billingCustomerId` must already be the bill-to (a
 * contract's `invoiceCustomerId ?? customerId`); it is loaded scoped to
 * `companyId`, so a customer of another company resolves to `unavailable`
 * before anything reaches Stripe.
 *
 * `customerContactId` is optional: a contract need not name an invoice
 * contact, and the Stripe customer's email can then come only from
 * `emailOverride`.
 */
export async function resolveStripeCustomerForBilling({
  serviceRole,
  companyId,
  billingCustomerId,
  customerContactId,
  emailOverride
}: {
  serviceRole: ServiceRole;
  companyId: string;
  billingCustomerId: string;
  customerContactId?: string | null;
  emailOverride?: string;
}): Promise<StripeCustomerResolutionResult> {
  const stripeAccountId = await getStripeConnectAccountId(
    serviceRole,
    companyId
  );
  if (!stripeAccountId) return notConnected();

  return resolveForAccount({
    serviceRole,
    companyId,
    stripeAccountId,
    billingCustomerId,
    customerContactId,
    emailOverride
  });
}

async function resolveForAccount({
  serviceRole,
  companyId,
  stripeAccountId,
  billingCustomerId,
  customerContactId,
  emailOverride
}: {
  serviceRole: ServiceRole;
  companyId: string;
  stripeAccountId: string;
  billingCustomerId: string;
  customerContactId?: string | null;
  emailOverride?: string;
}): Promise<StripeCustomerResolutionResult> {
  const sources = await resolveStripeCustomerSources(
    serviceRole,
    companyId,
    billingCustomerId,
    customerContactId ?? null
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

/**
 * Act on the user's Stripe customer choice for the customer who is billed,
 * and link the result in `externalIntegrationMapping`.
 *
 * The choice comes from a form (the invoice post modal, the contract confirm
 * modal), so it is never taken at face value: the resolution is re-run here —
 * the same one the modal showed — and the action is checked against what the
 * connected account looks like now. That closes the gap between the dialog
 * being shown and the form being submitted (a customer deleted in the Stripe
 * dashboard, a mapping written by a concurrent post, a hand-rolled form body
 * naming someone else's customer id).
 *
 * `contactEmail` is an address the user typed for a contact that had none; it
 * is saved to that contact before resolving, so the match search runs on it.
 */
export async function linkStripeCustomerForBilling({
  serviceRole,
  companyId,
  userId,
  billingCustomerId,
  customerContactId,
  action,
  stripeCustomerId,
  contactEmail
}: {
  serviceRole: ServiceRole;
  companyId: string;
  userId: string;
  billingCustomerId: string;
  customerContactId?: string | null;
  action: (typeof stripeCustomerActions)[number];
  stripeCustomerId?: string;
  contactEmail?: string;
}): Promise<
  | {
      ok: true;
      stripeAccountId: string;
      stripeCustomerId: string;
      customerName: string;
    }
  | { ok: false; message: string }
> {
  if (contactEmail && customerContactId) {
    // customerContactId comes from the form and the service role bypasses RLS:
    // scope it so another company's contact is never read or rewritten.
    const contact = await getCustomerContact(
      serviceRole,
      customerContactId,
      companyId
    );
    if (contact.data && !contact.data.contact?.email) {
      const update = await updateCustomerContact(serviceRole, {
        contactId: contact.data.contactId,
        contact: {
          firstName: contact.data.contact?.firstName ?? "",
          lastName: contact.data.contact?.lastName ?? "",
          email: contactEmail
        }
      });
      if (update.error) {
        return { ok: false, message: "the contact email could not be saved" };
      }
    }
  }

  const resolveNow = () =>
    resolveStripeCustomerForBilling({
      serviceRole,
      companyId,
      billingCustomerId,
      customerContactId,
      emailOverride: contactEmail
    });

  const resolved = await resolveNow();

  if (!resolved.sources) {
    return {
      ok: false,
      message:
        resolved.resolution.state === "unavailable"
          ? resolved.resolution.message
          : "the Stripe customer could not be resolved"
    };
  }

  const { stripeAccountId, sources, input } = resolved;

  if (!input) {
    return { ok: false, message: "the selected contact has no email address" };
  }

  const customerName = sources.customer.name;
  if (!customerName) {
    return { ok: false, message: "the customer could not be loaded" };
  }

  let resolvedCustomerId: string;

  switch (action) {
    case "use-linked": {
      // The dialog showed a linked customer; it must still be linked and live.
      // Falling through to a create here would put a customer on the merchant's
      // account that the user never agreed to.
      if (resolved.resolution.state !== "linked") {
        return {
          ok: false,
          message:
            "the linked Stripe customer is no longer available — reopen the dialog"
        };
      }
      resolvedCustomerId = resolved.resolution.customer.id;
      break;
    }
    case "link-existing": {
      if (!stripeCustomerId) {
        return {
          ok: false,
          message: "no Stripe customer was selected to link"
        };
      }
      // Confirm the id exists on THIS connected account before writing it into
      // the mapping — an id from another account (or an invented one) would
      // otherwise be linked and every future invoice would fail at send.
      const existing = await retrieveConnectCustomer(
        stripeAccountId,
        stripeCustomerId
      );
      if (!existing) {
        return {
          ok: false,
          message: "that Stripe customer no longer exists on this account"
        };
      }
      resolvedCustomerId = existing.id;
      break;
    }
    case "create": {
      // A concurrent post (or a link made since the dialog opened) means this
      // Carbon customer now HAS a Stripe customer. Creating a second one is
      // exactly what this flow exists to prevent, so stop and let the user
      // confirm the one that now exists.
      if (resolved.resolution.state === "linked") {
        return {
          ok: false,
          message:
            "this customer was just linked to a Stripe customer — reopen the dialog to confirm it"
        };
      }
      try {
        resolvedCustomerId = await upsertConnectCustomer(
          stripeAccountId,
          null,
          input
        );
      } catch (err) {
        // A genuinely concurrent post for the same unlinked customer reuses
        // the same idempotency key (upsertConnectCustomer scopes it by
        // companyId+carbonCustomerId) — Stripe rejects the SECOND request
        // in-flight with an idempotency_error rather than returning the
        // first request's result. The winning request finishes and links
        // its mapping shortly after, so re-resolve once instead of failing
        // outright.
        if ((err as { type?: string }).type !== "idempotency_error") {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        const retried = await resolveNow();
        if (retried.resolution.state !== "linked") {
          throw err;
        }
        resolvedCustomerId = retried.resolution.customer.id;
      }
      break;
    }
  }

  await createMappingService(getDatabaseClient(), companyId).link(
    "customer",
    billingCustomerId,
    STRIPE_CONNECT_INTEGRATION,
    resolvedCustomerId,
    { createdBy: userId }
  );

  return {
    ok: true,
    stripeAccountId,
    stripeCustomerId: resolvedCustomerId,
    customerName
  };
}
