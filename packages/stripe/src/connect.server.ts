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

/**
 * Carbon's decimal amount → Stripe's `unit_amount_decimal`, a value in the
 * currency's smallest unit that Stripe multiplies by the quantity itself.
 *
 * Unlike `toStripeAmount` this must NOT round to a whole minor unit: rounding
 * the per-unit price first and then multiplying by, say, 250 turns a half-cent
 * into $1.25 of drift. Goes through the SDK's `Decimal` rather than
 * `value * 100` because binary floating point makes 19.99 into
 * 1998.9999999999998, and that error is about to be multiplied.
 */
function toStripeMinorDecimal(
  value: number,
  currencyCode: string
): Stripe.Decimal {
  const minor = Stripe.Decimal.from(String(value)).mul(
    Stripe.Decimal.from(10 ** currencyExponent(currencyCode))
  );
  // Stripe accepts at most twelve decimal places; six is already far more
  // precision than any ERP unit price carries.
  return Stripe.Decimal.from(minor.toFixed(6, "half-even"));
}

/**
 * One Carbon customer, flattened into the shape Stripe's customer endpoint wants.
 *
 * Carbon spreads a customer across `customer`, `customerTax`, `customerContact`
 * → `contact`, and `customerPayment` → `customerLocation` → `address`. Folding
 * those together is the ERP's job, not this package's — building the payload
 * here would drag the generated DB types into `@carbon/stripe`. The caller
 * (`apps/erp/app/modules/invoicing/stripe-customer.server.ts`) owns the mapping
 * and hands over plain values.
 */
export type ConnectCustomerInput = {
  name: string;
  /**
   * Stripe accepts a customer with no email, but `collection_method:
   * "send_invoice"` — which `createAndSendConnectInvoice` always uses — has
   * nowhere to send the invoice without one. Required here so the failure
   * lands before an invoice is posted rather than at the send.
   */
  email: string;
  phone?: string;
  website?: string | null;
  /** `customer.readableId`; only ever applied on create. */
  readableId?: string | null;
  address?: Stripe.AddressParam;
  shipping?: Stripe.CustomerCreateParams.Shipping;
  /**
   * Already in Stripe's vocabulary. Interpreting Carbon's `taxExempt` /
   * `taxExemptionReason` pair is the ERP's job — this package does not know
   * that an `"Export"` sale is a reverse charge rather than an exemption.
   */
  taxExempt?: Stripe.CustomerCreateParams.TaxExempt;
  metadata: Record<string, string>;
};

/**
 * Stripe's `invoice_prefix` accepts 3–12 uppercase alphanumerics. Carbon's
 * `readableId` ("CUS000123") already fits once punctuation is stripped, but a
 * customer imported with a short or symbol-heavy id may not — return undefined
 * and let Stripe assign its own rather than send something it will reject.
 */
function toInvoicePrefix(readableId?: string | null): string | undefined {
  if (!readableId) return undefined;
  const cleaned = readableId.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return cleaned.length >= 3 ? cleaned.slice(0, 12) : undefined;
}

/**
 * Look a customer up on a connected account.
 *
 * Returns null — rather than throwing — when the id no longer resolves, so a
 * stale `externalIntegrationMapping` row degrades into "offer to create one"
 * instead of a 500 in the middle of posting an invoice. Stripe returns deleted
 * customers as a `{ deleted: true }` stub rather than a 404, so both shapes
 * have to collapse to the same answer.
 */
export async function retrieveConnectCustomer(
  stripeAccountId: string,
  stripeCustomerId: string
): Promise<Stripe.Customer | null> {
  if (!stripe) {
    throw new Error("Stripe secret key is not configured.");
  }

  try {
    const customer = await stripe.customers.retrieve(
      stripeCustomerId,
      {},
      { stripeAccount: stripeAccountId }
    );
    return customer.deleted ? null : (customer as Stripe.Customer);
  } catch (err) {
    if (
      err instanceof Stripe.errors.StripeError &&
      err.code === "resource_missing"
    ) {
      return null;
    }
    throw err;
  }
}

/**
 * Find customers on a connected account by exact email.
 *
 * Uses `customers.list({ email })` rather than `customers.search`: search runs
 * against an index that lags writes by up to a minute, so a customer created
 * moments ago would not be found and would be duplicated. `list` reads straight
 * through.
 *
 * `limit: 2` is deliberate — the caller only needs to know "none", "exactly
 * one", or "more than one". A shared AP mailbox across subsidiaries produces
 * several, and that ambiguity must reach the user rather than be resolved by
 * taking the first row.
 */
export async function findConnectCustomersByEmail(
  stripeAccountId: string,
  email: string
): Promise<Stripe.Customer[]> {
  if (!stripe) {
    throw new Error("Stripe secret key is not configured.");
  }

  const matches = await stripe.customers.list(
    { email, limit: 2 },
    { stripeAccount: stripeAccountId }
  );

  return matches.data;
}

/**
 * Create a customer on a connected account, or update one that already exists.
 *
 * Two parameters are create-only and are therefore absent from the update path:
 * `invoice_prefix` (updatable in the API, but it must stay unique across the
 * account and rewriting it after invoices exist re-numbers nothing that already
 * shipped) and `tax_id_data`, which Stripe's update endpoint does not accept at
 * all — changing tax ids there means `createTaxId`/`deleteTaxId`.
 */
export async function upsertConnectCustomer(
  stripeAccountId: string,
  stripeCustomerId: string | null,
  input: ConnectCustomerInput
): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe secret key is not configured.");
  }

  const options = { stripeAccount: stripeAccountId };

  const payload: Stripe.CustomerUpdateParams = {
    name: input.name,
    // Stripe renders `name` in the dashboard but prefers `business_name` on
    // invoice PDFs; Carbon has one company name for both.
    business_name: input.name,
    email: input.email,
    phone: input.phone,
    address: input.address,
    shipping: input.shipping,
    description: input.website ? `Website: ${input.website}` : undefined,
    tax_exempt: input.taxExempt ?? "none",
    metadata: input.metadata
  };

  if (stripeCustomerId) {
    const updated = await stripe.customers.update(
      stripeCustomerId,
      payload,
      options
    );
    return updated.id;
  }

  const created = await stripe.customers.create(
    {
      ...payload,
      invoice_prefix: toInvoicePrefix(input.readableId)
    },
    {
      ...options,
      // Posting an invoice is retryable from the UI, and a retry that got as
      // far as creating the customer but not as far as writing the mapping row
      // would otherwise leave a duplicate on the merchant's account.
      idempotencyKey: `customer:${stripeAccountId}:${input.metadata.carbon_customer_id}`
    }
  );

  return created.id;
}

/**
 * One Carbon `salesInvoiceLine`, as the Stripe mapping needs to see it.
 *
 * The cost components are NOT interchangeable and — apart from `unitPrice` —
 * are NOT per-unit. This mirrors the `salesInvoices` view, which is the single
 * definition of what a Carbon sales invoice is worth (migration
 * `20260702224219_fix-ar-ap-legacy-paid.sql`):
 *
 *   subtotal = Σ (quantity·unitPrice + addOnCost + nonTaxableAddOnCost + shippingCost)
 *   totalTax = Σ taxPercent·(quantity·unitPrice + addOnCost + shippingCost)
 *   total    = subtotal + totalTax + salesInvoiceShipment.shippingCost
 *
 * Three consequences worth stating out loud, because each one is a way to bill
 * the customer an amount Carbon's ledger disagrees with:
 *  - `nonTaxableAddOnCost` counts toward the subtotal but NOT the tax base.
 *  - the header-level shipping cost is added AFTER tax and is never taxed.
 *  - `setupPrice` appears in neither sum, so it is deliberately absent from
 *    this type. Billing it would collect more cash than the invoice is owed,
 *    and `recordStripeConnectPayment` settles whatever Stripe collected.
 */
export type ConnectInvoiceLineInput = {
  description: string;
  /** `salesInvoiceLine.quantity` — NUMERIC, so genuinely fractional. */
  quantity: number;
  /** Per-unit price, in the invoice currency (never the `converted*` mirror). */
  unitPrice: number;
  /** Flat per-line surcharge, taxable. Not multiplied by quantity. */
  addOnCost?: number;
  /** Flat per-line freight, taxable. Not multiplied by quantity. */
  shippingCost?: number;
  /** Flat per-line surcharge, NOT taxed. */
  nonTaxableAddOnCost?: number;
  /**
   * A FRACTION in [0, 1] — that is the column's CHECK constraint, not a
   * percent. 0.0825 means 8.25%. Passing 8.25 here would bill 825% tax.
   */
  taxPercent?: number;
  unitOfMeasureCode?: string | null;
  /** Carbon ids for traceability; merged into every item this line emits. */
  metadata?: Record<string, string>;
};

export type ConnectInvoiceInput = {
  lines: ConnectInvoiceLineInput[];
  currencyCode: string;
  /** `salesInvoiceShipment.shippingCost` — invoice-level, and never taxed. */
  shippingCost?: number;
  /** Carbon's human-readable `invoiceId`, printed as Stripe's invoice number. */
  invoiceNumber?: string;
  /**
   * Unix SECONDS. The caller resolves Carbon's calendar date on the company's
   * business timezone — this package has no business calendar of its own.
   */
  dueDate?: number;
  /** Unix SECONDS. Overrides the "Date of issue" printed on the Stripe PDF. */
  effectiveAt?: number;
  /** Fallback when `dueDate` is absent; Stripe takes one or the other. */
  daysUntilDue?: number;
  /** Customer-facing. Carbon's external notes, already flattened to text. */
  description?: string;
  footer?: string;
  /** Stripe renders at most 4. */
  customFields?: { name: string; value: string }[];
  shippingDetails?: {
    name: string;
    phone?: string;
    address: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      /** ISO 3166-1 alpha-2, which is what Carbon's `countryCode` already is. */
      country?: string;
    };
  };
  metadata?: Record<string, string>;
};

/**
 * What Carbon says this invoice is worth, by the `salesInvoices` view's own
 * arithmetic. Exported so callers gate on the same number Stripe will be
 * reconciled against instead of an independent (and quietly different) sum.
 */
export function expectedConnectInvoiceTotal(params: {
  lines: ConnectInvoiceLineInput[];
  shippingCost?: number;
}): { subtotal: number; tax: number; shipping: number; total: number } {
  let subtotal = 0;
  let tax = 0;

  for (const line of params.lines) {
    const taxable =
      line.unitPrice * line.quantity +
      (line.addOnCost ?? 0) +
      (line.shippingCost ?? 0);
    subtotal += taxable + (line.nonTaxableAddOnCost ?? 0);
    tax += (line.taxPercent ?? 0) * taxable;
  }

  const shipping = params.shippingCost ?? 0;
  return { subtotal, tax, shipping, total: subtotal + tax + shipping };
}

// Tax rate ids resolved this process, keyed by account + percentage. Stripe has
// no upsert for tax rates, so without this every line of every invoice would
// re-list (and race to re-create) the same rate.
const TAX_RATE_IDS = new Map<string, string>();

/** Carbon's `taxPercent` fraction → Stripe's `percentage`, which is out of 100. */
function toStripePercentage(taxPercent: number): number {
  // 0.0825 * 100 is 8.250000000000002 in floating point, and Stripe takes at
  // most four decimal places on `percentage`.
  return Math.round(taxPercent * 1_000_000) / 10_000;
}

/**
 * The connected account's Stripe Tax Rate for a given percentage, created on
 * first use. Carbon stores a bare number per line; Stripe only accepts ids.
 *
 * Scoped to the connected account (`stripeAccount`) — a rate created on the
 * platform account is invisible to the account actually issuing the invoice.
 */
async function resolveConnectTaxRateId(
  stripeAccountId: string,
  percentage: number
): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe secret key is not configured.");
  }

  const cacheKey = `${stripeAccountId}:${percentage}`;
  const cached = TAX_RATE_IDS.get(cacheKey);
  if (cached) return cached;

  const options = { stripeAccount: stripeAccountId };

  // `list` returns 10 per page by default. Matching against only the first page
  // is how an account ends up with a dozen identical 8.25% rates.
  let match: Stripe.TaxRate | undefined;
  await stripe.taxRates
    .list({ active: true, inclusive: false, limit: 100 }, options)
    .autoPagingEach((rate) => {
      if (rate.percentage === percentage) {
        match = rate;
        return false;
      }
    });

  const taxRate =
    match ??
    (await stripe.taxRates.create(
      {
        display_name: "Tax",
        description: `Carbon ${percentage}%`,
        percentage,
        // Carbon's totals add tax ON TOP of the subtotal, so the rate is
        // exclusive. An inclusive rate would carve the tax out of the price and
        // undercharge by exactly the tax.
        inclusive: false,
        metadata: { carbonTaxPercent: String(percentage) }
      },
      options
    ));

  TAX_RATE_IDS.set(cacheKey, taxRate.id);
  return taxRate.id;
}

export async function createAndSendConnectInvoice(
  stripeAccountId: string,
  stripeCustomerId: string,
  params: ConnectInvoiceInput
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
  const expected = expectedConnectInvoiceTotal(params);
  const expectedMinor = toStripeAmount(expected.total, currency);

  // Stripe refuses to send a zero-amount invoice, and the resulting API error
  // ("This invoice cannot be sent right now") gives no hint why — so fail here
  // with something actionable instead.
  if (!params.lines.length || expectedMinor <= 0) {
    throw new Error(
      "the invoice has no billable lines (Stripe cannot send a zero-amount invoice)"
    );
  }

  // Carbon splits one line into components that tax differently and that Stripe
  // has no single-item representation for, so one Carbon line becomes up to
  // four Stripe items. Built before the draft exists so a bad line (an
  // unresolvable tax rate) fails without leaving an orphaned draft behind.
  const items: Stripe.InvoiceItemCreateParams[] = [];

  for (const line of params.lines) {
    const label = line.description?.trim() || "Item";
    const percentage = line.taxPercent
      ? toStripePercentage(line.taxPercent)
      : 0;
    const taxRates = percentage
      ? [await resolveConnectTaxRateId(stripeAccountId, percentage)]
      : undefined;

    const base = {
      customer: stripeCustomerId,
      currency
    } satisfies Partial<Stripe.InvoiceItemCreateParams>;

    // Emitted even at a unit price of zero: a free or included line contributes
    // nothing to the total but is still something the customer expects to read
    // on the invoice, and Stripe accepts zero-amount items.
    if (line.quantity > 0) {
      items.push({
        ...base,
        description: line.unitOfMeasureCode
          ? `${label} (${line.unitOfMeasureCode})`
          : label,
        // `amount` is mutually exclusive with the quantity fields, so the unit
        // breakdown only survives onto the PDF via this pair. `quantity` alone
        // is an integer and would truncate Carbon's fractional quantities —
        // 2.5 hours would bill as 2.
        unit_amount_decimal: toStripeMinorDecimal(line.unitPrice, currency),
        quantity_decimal: Stripe.Decimal.from(String(line.quantity)),
        tax_rates: taxRates,
        metadata: { ...line.metadata, carbonComponent: "unit" }
      });
    }

    // The flat components carry no quantity, so they use `amount` directly.
    if (line.addOnCost) {
      items.push({
        ...base,
        description: `${label} — Additional charges`,
        amount: toStripeAmount(line.addOnCost, currency),
        tax_rates: taxRates,
        metadata: { ...line.metadata, carbonComponent: "addOnCost" }
      });
    }

    if (line.shippingCost) {
      items.push({
        ...base,
        description: `${label} — Freight`,
        amount: toStripeAmount(line.shippingCost, currency),
        tax_rates: taxRates,
        metadata: { ...line.metadata, carbonComponent: "shippingCost" }
      });
    }

    if (line.nonTaxableAddOnCost) {
      items.push({
        ...base,
        description: `${label} — Additional charges (non-taxable)`,
        amount: toStripeAmount(line.nonTaxableAddOnCost, currency),
        // Deliberately no `tax_rates` — this component is outside the tax base
        // in the view, and an empty array here is what keeps it that way.
        tax_rates: [],
        metadata: { ...line.metadata, carbonComponent: "nonTaxableAddOnCost" }
      });
    }
  }

  if (params.shippingCost) {
    items.push({
      customer: stripeCustomerId,
      currency,
      description: "Shipping",
      amount: toStripeAmount(params.shippingCost, currency),
      tax_rates: [],
      metadata: { carbonComponent: "invoiceShippingCost" }
    });
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
      // Stripe takes one or the other, and `due_date` is only valid under
      // `send_invoice`. Prefer the real date: deriving a day count from
      // dateDue − dateIssued loses the date Carbon actually posted.
      ...(params.dueDate
        ? { due_date: params.dueDate }
        : { days_until_due: params.daysUntilDue ?? 30 }),
      ...(params.effectiveAt ? { effective_at: params.effectiveAt } : {}),
      // Stripe assigns its own number when this is unset; passing Carbon's
      // keeps one identifier across both systems on the PDF the customer sees.
      // Stripe does not dedupe against numbers issued elsewhere — a second
      // finalize under the same number is rejected at finalization, which is
      // the correct outcome for a double-send.
      ...(params.invoiceNumber ? { number: params.invoiceNumber } : {}),
      ...(params.description ? { description: params.description } : {}),
      ...(params.footer ? { footer: params.footer } : {}),
      ...(params.customFields?.length
        ? { custom_fields: params.customFields.slice(0, 4) }
        : {}),
      ...(params.shippingDetails
        ? { shipping_details: params.shippingDetails }
        : {}),
      auto_advance: false,
      metadata: params.metadata
    },
    options
  );

  // Sequential, not Promise.all: invoice items render in creation order, and a
  // reordered PDF would not match the Carbon invoice beside it.
  for (const item of items) {
    await stripe.invoiceItems.create(
      { ...item, invoice: invoice.id! },
      options
    );
  }

  // Stripe totals the draft itself, which makes it the only honest check that
  // this mapping is complete: whatever it says here is what the customer pays
  // and what `recordStripeConnectPayment` will settle against the Carbon
  // invoice. A silent divergence leaves a permanent residual balance.
  const draft = await stripe.invoices.retrieve(invoice.id!, {}, options);
  const drift = Math.abs((draft.total ?? 0) - expectedMinor);
  // Carbon rounds tax once over the whole invoice; Stripe rounds per item. Each
  // item can therefore land a single minor unit either way, and Carbon forgives
  // sub-cent residuals (`INVOICE_DUST_THRESHOLD`). Anything past that is a
  // mapping bug, not rounding.
  if (drift > items.length) {
    await stripe.invoices.del(invoice.id!, {}, options);
    throw new Error(
      `the Stripe invoice totals ${fromStripeAmount(draft.total ?? 0, currency)} ${currency.toUpperCase()} but the Carbon invoice totals ${expected.total} — refusing to send`
    );
  }
  if (drift > 0) {
    log.warn("Stripe Connect invoice total differs from Carbon by rounding", {
      stripeAccountId,
      invoiceId: invoice.id,
      driftMinorUnits: drift
    });
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
