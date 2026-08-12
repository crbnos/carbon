import type { Database } from "@carbon/database";
import { STRIPE_CONNECT_WEBHOOK_SECRET, STRIPE_SECRET_KEY } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Stripe } from "stripe";
import { STRIPE_CONNECT_ACCOUNT_CONFIG } from "./connect.constants";
import { stripe } from "./stripe.server";

const log = getLogger("stripe-connect");

const stripeConnect = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2026-07-29.dahlia",
      typescript: true
    })
  : null;

function deriveConnectAccountMetadata(account: Stripe.V2.Core.Account) {
  const capabilities = account.configuration?.merchant?.capabilities;
  const entries = account.requirements?.entries ?? [];
  const requirementErrors = entries
    .flatMap((entry) => entry.errors ?? [])
    .map((requirementError) => requirementError.description);

  return {
    chargesEnabled: capabilities?.card_payments?.status === "active",
    payoutsEnabled: capabilities?.stripe_balance?.payouts?.status === "active",
    detailsSubmitted: !entries.length,
    requirementErrors
  };
}

export async function getOrCreateConnectAccount(
  client: SupabaseClient<Database>,
  companyId: string,
  userEmail: string
): Promise<string> {
  if (!stripeConnect) {
    throw new Error("Stripe secret key is not configured.");
  }
  // TODO: Should I also fetch stripe connect capability here?
  // 1. Check if company already has a companyIntegration row for stripe-connect
  const existingIntegration = await client
    .from("companyIntegration")
    .select("metadata, active")
    .eq("id", "stripe-connect")
    .eq("companyId", companyId)
    .maybeSingle();

  const existingMeta = existingIntegration.data?.metadata as
    | Record<string, unknown>
    | undefined;
  let stripeAccountId = existingMeta?.stripeAccountId as string | undefined;

  if (stripeAccountId) {
    return stripeAccountId;
  }

  // 2. Fetch company details to pre-populate Stripe Connect onboarding form
  const company = await client
    .from("company")
    .select("*")
    .eq("id", companyId)
    .single();

  if (company.error || !company.data) {
    throw new Error("Failed to load company details for Stripe Connect.");
  }

  const comp = company.data;
  const countryCode = comp.countryCode || "US";
  const contactEmail = comp.email || userEmail;

  const account = await stripeConnect.v2.core.accounts.create({
    contact_email: contactEmail,
    display_name: comp.name,
    dashboard: STRIPE_CONNECT_ACCOUNT_CONFIG.dashboard,
    identity: {
      country: countryCode,
      entity_type: STRIPE_CONNECT_ACCOUNT_CONFIG.entityType,
      business_details: {
        registered_name: comp.name,
        phone: comp.phone || undefined,
        address: {
          line1: comp.addressLine1 || undefined,
          line2: comp.addressLine2 || undefined,
          city: comp.city || undefined,
          state: comp.stateProvince || undefined,
          postal_code: comp.postalCode || undefined,
          country: countryCode
        }
      }
    },
    configuration: {
      merchant: {
        // stripe_balance.payouts (which replaces v1's `transfers` capability) has no
        // separate opt-in on Merchant configuration create — it activates once the
        // merchant configuration itself is applied and verification requirements clear.
        capabilities: {
          ach_debit_payments: { requested: true },
          card_payments: { requested: true }
        },
        support: {
          email: contactEmail,
          phone: comp.phone || undefined
        }
      }
    },
    defaults: {
      responsibilities: {
        fees_collector:
          STRIPE_CONNECT_ACCOUNT_CONFIG.responsibilities.feesCollector,
        losses_collector:
          STRIPE_CONNECT_ACCOUNT_CONFIG.responsibilities.lossesCollector
      }
    },
    metadata: {
      companyId
    },
    include: ["configuration.merchant", "requirements"]
  });

  stripeAccountId = account.id;

  await client.from("companyIntegration").upsert({
    id: "stripe-connect",
    companyId,
    active: true,
    metadata: {
      ...existingMeta,
      stripeAccountId,
      ...deriveConnectAccountMetadata(account)
    }
  });

  return stripeAccountId;
}

export async function createConnectAccountLink(
  stripeAccountId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<string> {
  if (!stripeConnect) {
    throw new Error("Stripe secret key is not configured.");
  }

  const accountLink = await stripeConnect.v2.core.accountLinks.create({
    account: stripeAccountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["merchant"],
        return_url: returnUrl,
        refresh_url: refreshUrl
      }
    }
  });

  return accountLink.url;
}

export async function getConnectAccountStatus(stripeAccountId: string) {
  if (!stripeConnect) {
    return null;
  }

  try {
    const account = await stripeConnect.v2.core.accounts.retrieve(
      stripeAccountId,
      {
        include: ["configuration.merchant", "requirements"]
      }
    );

    return {
      stripeAccountId: account.id,
      ...deriveConnectAccountMetadata(account),
      email: account.contact_email,
      displayName: account.display_name
    };
  } catch (err) {
    log.error("Failed to retrieve Stripe Connect account status", {
      error: err
    });
    return null;
  }
}

export async function createExpressDashboardLoginLink(
  stripeAccountId: string
): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe secret key is not configured.");
  }

  // Express Dashboard login links remain a v1 endpoint. Per Stripe's v2/v1
  // interoperability model, v1 endpoints accept v2-created Account IDs directly, so
  // this stays on the shared v1-pinned client rather than the Connect v2 client.
  const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
  return loginLink.url;
}

// --- Invoicing against a connected account ---
// Everything below operates on an existing Connect account (see above) to
// create and send a Stripe invoice on its behalf. Same v1/v2 interop rule as
// createExpressDashboardLoginLink: Invoicing is a v1-only API surface, so it
// stays on the shared v1-pinned `stripe` client with `{ stripeAccount }`
// rather than the v2 `stripeConnect` client used for account management.

// Stripe expresses amounts in a currency's smallest unit, and the number of
// decimal places is currency-dependent — ¥1000 is `1000`, not `100000`. Anything
// not listed here is the ordinary 2-decimal case.
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF"
]);

const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

function currencyExponent(currencyCode: string): number {
  const code = currencyCode.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

/** Carbon's decimal amount → Stripe's smallest-unit integer. */
export function toStripeAmount(value: number, currencyCode: string): number {
  const factor = 10 ** currencyExponent(currencyCode);
  const minor = Math.round(value * factor);
  // Stripe rejects three-decimal amounts that aren't a multiple of 10 (the
  // smallest unit is charged in hundredths for these currencies).
  return currencyExponent(currencyCode) === 3
    ? Math.round(minor / 10) * 10
    : minor;
}

/** Stripe's smallest-unit integer → Carbon's decimal amount. */
export function fromStripeAmount(minor: number, currencyCode: string): number {
  return minor / 10 ** currencyExponent(currencyCode);
}

export async function createConnectCustomer(
  stripeAccountId: string,
  customer: { name: string; email: string }
): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe secret key is not configured.");
  }

  const stripeCustomer = await stripe.customers.create(
    { name: customer.name, email: customer.email },
    { stripeAccount: stripeAccountId }
  );

  return stripeCustomer.id;
}

export async function createAndSendConnectInvoice(
  stripeAccountId: string,
  stripeCustomerId: string,
  params: {
    lines: { description: string; quantity: number; unitPrice: number }[];
    currencyCode: string;
    daysUntilDue: number;
    metadata?: Record<string, string>;
  }
): Promise<{
  id: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}> {
  if (!stripe) {
    throw new Error("Stripe secret key is not configured.");
  }

  const currency = params.currencyCode.toLowerCase();
  const options = { stripeAccount: stripeAccountId };

  // Stripe refuses to send a zero-amount invoice, and the resulting API error
  // ("This invoice cannot be sent right now") gives no hint why — so fail here
  // with something actionable instead.
  const total = params.lines.reduce(
    (sum, line) =>
      sum + toStripeAmount(line.unitPrice * line.quantity, currency),
    0
  );
  if (!params.lines.length || total <= 0) {
    throw new Error(
      "the invoice has no billable lines (Stripe cannot send a zero-amount invoice)"
    );
  }

  // Create the draft FIRST, then attach each item to it by id. Creating items
  // against the customer alone leaves them as *pending* items that a standalone
  // invoice does not pick up unless it passes `pending_invoice_items_behavior:
  // "include"` — and any item left unconsumed silently lands on the next
  // invoice created for that customer. Attaching explicitly avoids both traps.
  const invoice = await stripe.invoices.create(
    {
      customer: stripeCustomerId,
      currency,
      collection_method: "send_invoice",
      days_until_due: params.daysUntilDue,
      auto_advance: false,
      metadata: params.metadata
    },
    options
  );

  for (const line of params.lines) {
    // `amount` and `quantity` are mutually exclusive on invoice items, and the
    // per-unit alternative (`price_data`) requires a pre-existing Product — so
    // send the line total and carry the quantity breakdown in the description.
    const description = line.description || "Item";
    await stripe.invoiceItems.create(
      {
        customer: stripeCustomerId,
        invoice: invoice.id!,
        currency,
        description:
          line.quantity === 1
            ? description
            : `${description} (${line.quantity} × ${line.unitPrice})`,
        amount: toStripeAmount(line.unitPrice * line.quantity, currency)
      },
      options
    );
  }

  // Finalizing is what mints `hosted_invoice_url` and `invoice_pdf` — both are
  // null on a draft. Sending is a separate step that only handles email
  // delivery (and is a no-op for email in test mode).
  const finalized = await stripe.invoices.finalizeInvoice(
    invoice.id!,
    {},
    options
  );
  const sent = await stripe.invoices.sendInvoice(finalized.id!, {}, options);

  return {
    id: sent.id!,
    hostedInvoiceUrl: sent.hosted_invoice_url ?? null,
    invoicePdf: sent.invoice_pdf ?? null
  };
}

// --- Connect webhooks ---
// Connected-account events arrive at a SEPARATE endpoint registered with
// `connect: true`, signed with its own secret and carrying `event.account`.
// Deliberately kept out of `processStripeEvent` (@carbon/stripe/AGENTS.md fences
// that to platform subscription state).

// Re-exported so consumers (the ERP app) can type webhook payloads without
// taking a direct dependency on the `stripe` package themselves.
export type ConnectWebhookEvent = Stripe.Event;
export type ConnectInvoice = Stripe.Invoice;

export function constructConnectWebhookEvent({
  body,
  signature
}: {
  body: string;
  signature: string;
}) {
  if (!stripe) {
    return {
      success: false as const,
      event: null,
      error: new Error("Stripe is not initialized")
    };
  }

  if (!STRIPE_CONNECT_WEBHOOK_SECRET) {
    return {
      success: false as const,
      event: null,
      error: new Error("STRIPE_CONNECT_WEBHOOK_SECRET is not configured")
    };
  }

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      STRIPE_CONNECT_WEBHOOK_SECRET
    );
    return { success: true as const, event, error: null };
  } catch (err) {
    return { success: false as const, event: null, error: err as Error };
  }
}

export type ConnectInvoicePaymentDetails = {
  /** Charge ids behind this invoice's payments, for traceability. */
  chargeIds: string[];
  /** Stripe's processing fee, as a decimal amount in `feeCurrency`. */
  feeAmount: number;
  /**
   * Currency the fee was assessed in — the account's SETTLEMENT currency, which
   * is not necessarily the invoice currency. Callers must compare before booking.
   */
  feeCurrency: string | null;
};

/**
 * The charges (and Stripe's fee) behind a paid invoice on a connected account.
 *
 * The shared v1 client is pinned to `2025-06-30.basil`, where `invoice.charge`
 * and `invoice.payment_intent` no longer exist — payments hang off
 * `invoice.payments` as InvoicePayment objects instead. The fee itself only
 * lives on the charge's balance transaction, so each payment costs one extra
 * expanded retrieve.
 *
 * Never throws: a fee we can't resolve returns `feeAmount: 0` with a logged
 * warning, because failing to book a fee must not cost us the payment itself.
 */
export async function getConnectInvoicePaymentDetails(
  stripeAccountId: string,
  invoiceId: string
): Promise<ConnectInvoicePaymentDetails> {
  const empty: ConnectInvoicePaymentDetails = {
    chargeIds: [],
    feeAmount: 0,
    feeCurrency: null
  };

  if (!stripe) return empty;

  const options = { stripeAccount: stripeAccountId };

  try {
    // Listed rather than read off the webhook's invoice snapshot: `payments` is
    // an expandable sub-list, so the delivered payload may carry only the first
    // page (or none at all).
    const payments = await stripe.invoicePayments.list(
      { invoice: invoiceId, limit: 100 },
      options
    );

    const chargeIds: string[] = [];
    let feeMinor = 0;
    let feeCurrency: string | null = null;

    for (const payment of payments.data) {
      if (payment.status !== "paid") continue;

      let charge: Stripe.Charge | null = null;
      const source = payment.payment;

      if (source.charge) {
        const chargeId =
          typeof source.charge === "string" ? source.charge : source.charge.id;
        charge = await stripe.charges.retrieve(
          chargeId,
          { expand: ["balance_transaction"] },
          options
        );
      } else if (source.payment_intent) {
        const paymentIntentId =
          typeof source.payment_intent === "string"
            ? source.payment_intent
            : source.payment_intent.id;
        const paymentIntent = await stripe.paymentIntents.retrieve(
          paymentIntentId,
          { expand: ["latest_charge.balance_transaction"] },
          options
        );
        charge =
          typeof paymentIntent.latest_charge === "string"
            ? null
            : (paymentIntent.latest_charge ?? null);
      }

      if (!charge) continue;
      chargeIds.push(charge.id);

      const balanceTransaction = charge.balance_transaction;
      if (balanceTransaction && typeof balanceTransaction !== "string") {
        feeMinor += balanceTransaction.fee;
        feeCurrency = balanceTransaction.currency.toUpperCase();
      }
    }

    return {
      chargeIds,
      feeAmount: feeCurrency ? fromStripeAmount(feeMinor, feeCurrency) : 0,
      feeCurrency
    };
  } catch (err) {
    log.warn("Failed to resolve Stripe Connect invoice payment details", {
      error: err,
      invoiceId,
      stripeAccountId
    });
    return empty;
  }
}
