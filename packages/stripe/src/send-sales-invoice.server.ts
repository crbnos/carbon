// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database, Json } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import { getDocumentType, storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import {
  datetime,
  stripSpecialCharacters,
  toDocumentAmount
} from "@carbon/utils";
import { parseDate, Time, toCalendarDateTime } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAndSendConnectInvoice } from "./connect.server";
import { toStripeInvoiceLines } from "./connect-invoice";

const logger = getLogger("stripe-connect");

type ServiceRole = SupabaseClient<Database>;

export const STRIPE_CONNECT_INTEGRATION = "stripe-connect";

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
 * The Stripe customer a Carbon customer is linked to on the connected account,
 * or null when no link exists. Reads the row `createMappingService.link`
 * writes for `("customer", customerId, STRIPE_CONNECT_INTEGRATION, …)`.
 */
export async function getLinkedStripeCustomerId(
  serviceRole: ServiceRole,
  companyId: string,
  customerId: string
): Promise<string | null> {
  const mapping = await serviceRole
    .from("externalIntegrationMapping")
    .select("externalId")
    .eq("entityType", "customer")
    .eq("entityId", customerId)
    .eq("integration", STRIPE_CONNECT_INTEGRATION)
    .eq("companyId", companyId)
    .maybeSingle();

  if (mapping.error) {
    logger.error("Failed to read the Stripe customer link", {
      companyId,
      customerId,
      error: mapping.error
    });
    throw new Error("Failed to read the Stripe customer link");
  }

  return mapping.data?.externalId ?? null;
}

/**
 * The settlement decimals of a currency, from the company group's own currency
 * configuration — the authoritative scale for a document-currency amount.
 */
async function getCurrencyDecimals(
  serviceRole: ServiceRole,
  companyId: string,
  currencyCode: string
): Promise<number> {
  const company = await serviceRole
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  if (company.error || !company.data?.companyGroupId) {
    logger.error("Failed to read the company group for currency precision", {
      companyId,
      error: company.error
    });
    throw new Error("Failed to read the company's currency configuration");
  }

  const currency = await serviceRole
    .from("currency")
    .select("decimalPlaces")
    .eq("companyGroupId", company.data.companyGroupId)
    .eq("code", currencyCode)
    .maybeSingle();
  if (currency.error || currency.data?.decimalPlaces == null) {
    logger.error("Failed to read the invoice currency's precision", {
      companyId,
      currencyCode,
      error: currency.error
    });
    throw new Error(`Currency ${currencyCode} has no precision configured`);
  }

  return currency.data.decimalPlaces;
}

async function storeStripeInvoicePdf({
  serviceRole,
  invoicePdf,
  invoiceId,
  readableInvoiceId,
  opportunityId,
  companyId,
  userId
}: {
  serviceRole: ServiceRole;
  invoicePdf: string | null;
  invoiceId: string;
  readableInvoiceId: string | null;
  opportunityId: string | null;
  companyId: string;
  userId: string;
}) {
  if (!invoicePdf) return;

  // Storage layout is opportunity-scoped; without one this would write into a
  // literal "opportunity/null/" folder. The PDF is still reachable via the
  // Stripe hosted invoice URL, so skip the store rather than corrupt the path.
  if (!opportunityId) return;

  const response = await fetch(invoicePdf, {
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download Stripe invoice PDF (${response.status})`
    );
  }
  const file = await response.arrayBuffer();

  const fileName = stripSpecialCharacters(
    `${readableInvoiceId ?? invoiceId} - Stripe.pdf`
  );
  const filePath = `${companyId}/opportunity/${opportunityId}/${fileName}`;

  const upload = await storage(serviceRole)
    .company(companyId)
    .upload(filePath, file, {
      cacheControl: `${12 * 60 * 60}`,
      contentType: "application/pdf",
      upsert: true
    });

  if (upload.error) {
    throw new Error("Failed to upload Stripe invoice PDF");
  }

  // The same insert the ERP's `upsertDocument` makes for a new document.
  const document = await serviceRole
    .from("document")
    .insert({
      path: filePath,
      name: fileName,
      size: Math.round(file.byteLength / 1024),
      sourceDocument: "Sales Invoice",
      sourceDocumentId: invoiceId,
      readGroups: [userId],
      writeGroups: [userId],
      createdBy: userId,
      companyId,
      type: getDocumentType(fileName)
    })
    .select("*")
    .single();

  if (document.error) {
    throw new Error("Failed to create document for the Stripe invoice PDF");
  }
}

async function appendStripeLinkToNotes({
  serviceRole,
  invoiceId,
  companyId,
  hostedInvoiceUrl,
  userId
}: {
  serviceRole: ServiceRole;
  invoiceId: string;
  companyId: string;
  hostedInvoiceUrl: string | null;
  userId: string;
}) {
  if (!hostedInvoiceUrl) return;

  const existing = await serviceRole
    .from("salesInvoice")
    .select("internalNotes")
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .single();

  if (existing.error) {
    throw new Error("Failed to read invoice notes");
  }

  const current = (existing.data?.internalNotes ?? {}) as {
    type?: string;
    content?: Json[];
  };
  const content = Array.isArray(current.content) ? current.content : [];

  const notes: Json = {
    type: "doc",
    content: [
      ...content,
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Stripe payment link: " },
          {
            type: "text",
            text: hostedInvoiceUrl,
            marks: [{ type: "link", attrs: { href: hostedInvoiceUrl } }]
          }
        ]
      }
    ]
  };

  const update = await serviceRole
    .from("salesInvoice")
    .update({
      internalNotes: notes,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", invoiceId)
    .eq("companyId", companyId);

  if (update.error) {
    throw new Error("Failed to write the Stripe payment link to invoice notes");
  }
}

export type { SalesInvoiceLineRow } from "./connect-invoice";
export { toStripeInvoiceLines } from "./connect-invoice";

/**
 * A Carbon calendar date → the Unix seconds Stripe wants.
 *
 * Anchored at midday on the company's business calendar rather than midnight:
 * Stripe renders the date in the connected account's own timezone, and a
 * midnight instant lands on the previous day for any account behind it.
 */
function toStripeEpochSeconds(
  date: string | null | undefined,
  timeZone: string
): number | undefined {
  if (!date) return undefined;
  return Math.trunc(
    toCalendarDateTime(parseDate(date), new Time(12))
      .toDate(timeZone)
      .getTime() / 1000
  );
}

const FIVE_YEARS_SECONDS = 5 * 365.25 * 24 * 60 * 60;

function clampDueDate(epoch: number | undefined): number | undefined {
  if (epoch === undefined) return undefined;
  // Native .toDate().getTime() is required to get Unix epoch seconds for Stripe.
  const now = Math.trunc(datetime.now("UTC").toDate().getTime() / 1000);
  if (epoch < now || epoch > now + FIVE_YEARS_SECONDS) return undefined;
  return epoch;
}

function clampEffectiveAt(epoch: number | undefined): number | undefined {
  if (epoch === undefined) return undefined;
  // Native .toDate().getTime() is required to get Unix epoch seconds for Stripe.
  const now = Math.trunc(datetime.now("UTC").toDate().getTime() / 1000);
  if (epoch > now) return now;
  if (epoch < now - FIVE_YEARS_SECONDS) return undefined;
  return epoch;
}

/**
 * Send an already-posted sales invoice through the company's connected Stripe
 * account, and link the Stripe invoice to it.
 *
 * Shared by the manual post route and invoice automation. The caller has
 * already resolved and linked the Stripe customer; this only builds and sends
 * the invoice. The mapping write is injected (`linkStripeInvoice`) so this
 * package needs no commercial dependency.
 *
 * Throws when the invoice cannot be read, created, sent or linked. Once the
 * Stripe invoice is sent, storing its PDF and writing its payment link to the
 * notes are best-effort: a failure there is logged, not thrown, because a
 * retry would create a SECOND Stripe invoice.
 */
export async function sendPostedSalesInvoiceViaStripe(args: {
  serviceRole: SupabaseClient<Database>;
  companyId: string;
  userId: string;
  invoiceId: string;
  stripeAccountId: string;
  stripeCustomerId: string;
  dueDateOverride?: string | null;
  linkStripeInvoice: (
    stripeInvoiceId: string,
    metadata: { hostedInvoiceUrl: string | null; invoicePdf: string | null }
  ) => Promise<void>;
}): Promise<{
  stripeInvoiceId: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}> {
  const {
    serviceRole,
    companyId,
    userId,
    invoiceId,
    stripeAccountId,
    stripeCustomerId,
    dueDateOverride,
    linkStripeInvoice
  } = args;

  const [salesInvoice, invoiceLines, shipment, addresses, timeZone] =
    await Promise.all([
      serviceRole
        .from("salesInvoices")
        .select("*")
        .eq("id", invoiceId)
        .eq("companyId", companyId)
        .single(),
      serviceRole
        .from("salesInvoiceLines")
        .select("*")
        .eq("invoiceId", invoiceId)
        .order("sortOrder", { ascending: true })
        .order("createdAt", { ascending: true }),
      serviceRole
        .from("salesInvoiceShipment")
        .select("*")
        .eq("id", invoiceId)
        .single(),
      serviceRole
        .from("salesInvoiceLocations")
        .select("*")
        .eq("id", invoiceId)
        .single(),
      getCompanyTimeZone(serviceRole, companyId)
    ]);

  if (salesInvoice.error || !salesInvoice.data) {
    logger.error("Failed to read the sales invoice for the Stripe send", {
      companyId,
      invoiceId,
      error: salesInvoice.error
    });
    throw new Error("Failed to get sales invoice");
  }

  const invoice = salesInvoice.data;
  const currencyCode = invoice.currencyCode ?? "USD";

  // `salesInvoiceShipment.shippingCost` is BASE currency, like every unprefixed
  // amount; Stripe bills the invoice currency. The lines arrive converted
  // (`toStripeInvoiceLines`), so only the header freight is converted here —
  // at the invoice exchange rate, as the printed invoice does.
  const baseShippingCost = shipment.data?.shippingCost ?? 0;
  const shippingCost = baseShippingCost
    ? toDocumentAmount(
        baseShippingCost,
        invoice.exchangeRate ?? 1,
        await getCurrencyDecimals(serviceRole, companyId, currencyCode)
      )
    : 0;

  // `salesInvoiceLocations` INNER JOINs the invoice's customer, so whenever the
  // row exists `customerName` is set — the trailing fallback is unreachable.
  const shippingAddress = addresses.data?.shipmentAddressLine1
    ? {
        name:
          addresses.data.shipmentCustomerName ??
          addresses.data.customerName ??
          "",
        address: {
          line1: addresses.data.shipmentAddressLine1 ?? undefined,
          line2: addresses.data.shipmentAddressLine2 ?? undefined,
          city: addresses.data.shipmentCity ?? undefined,
          state: addresses.data.shipmentStateProvince ?? undefined,
          postal_code: addresses.data.shipmentPostalCode ?? undefined,
          country: addresses.data.shipmentCountryCode ?? undefined
        }
      }
    : undefined;

  const stripeInvoice = await createAndSendConnectInvoice(
    stripeAccountId,
    stripeCustomerId,
    {
      lines: toStripeInvoiceLines(invoiceLines.data ?? []),
      currencyCode,
      // Invoice-level freight, which the salesInvoices view adds after
      // tax — it is not one of the taxable per-line components.
      shippingCost,
      invoiceNumber: invoice.invoiceId ?? undefined,
      // dueDateOverride is the user-chosen override from the post modal,
      // submitted only when the invoice's own dateDue wouldn't survive
      // clampDueDate (missing, past, or too far out). Re-clamped here
      // regardless of source — never trust client input for what
      // reaches a merchant's live Stripe account.
      dueDate: clampDueDate(
        toStripeEpochSeconds(dueDateOverride || invoice.dateDue, timeZone)
      ),
      effectiveAt: clampEffectiveAt(
        toStripeEpochSeconds(
          invoice.dateIssued ?? invoice.postingDate,
          timeZone
        )
      ),
      customFields: invoice.customerReference
        ? [
            {
              name: "Reference",
              value: invoice.customerReference
            }
          ]
        : undefined,
      shippingDetails: shippingAddress,
      metadata: {
        carbonInvoiceId: invoiceId,
        carbonInvoiceNumber: invoice.invoiceId ?? "",
        companyId,
        carbonOpportunityId: invoice.opportunityId ?? "",
        carbonShipmentId: invoice.shipmentId ?? ""
      },
      // One Carbon invoice is one Stripe invoice on this account: an Inngest
      // retry after Stripe already created (or sent) it replays that invoice.
      idempotencyKey: `carbon-invoice-${stripeAccountId}-${invoiceId}`
    }
  );

  await linkStripeInvoice(stripeInvoice.id, {
    hostedInvoiceUrl: stripeInvoice.hostedInvoiceUrl,
    invoicePdf: stripeInvoice.invoicePdf
  });

  // Best-effort cleanup — the Stripe invoice has already been created and
  // sent to the customer at this point, so a failure here must not read
  // as a failed send: that would prompt a retry and create a SECOND
  // Stripe invoice. Log and move on; the hosted invoice URL and PDF are
  // still reachable directly on Stripe if this drops.
  try {
    await Promise.all([
      storeStripeInvoicePdf({
        serviceRole,
        invoicePdf: stripeInvoice.invoicePdf,
        invoiceId,
        readableInvoiceId: invoice.invoiceId,
        opportunityId: invoice.opportunityId,
        companyId,
        userId
      }),
      appendStripeLinkToNotes({
        serviceRole,
        invoiceId,
        companyId,
        hostedInvoiceUrl: stripeInvoice.hostedInvoiceUrl,
        userId
      })
    ]);
  } catch (err) {
    logger.error("Stripe invoice sent, but post-send cleanup failed", {
      error: err,
      invoiceId
    });
  }

  return {
    stripeInvoiceId: stripeInvoice.id,
    hostedInvoiceUrl: stripeInvoice.hostedInvoiceUrl,
    invoicePdf: stripeInvoice.invoicePdf
  };
}
