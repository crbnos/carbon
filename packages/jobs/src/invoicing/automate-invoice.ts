// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Invoice automation: post a drafted recurring invoice unattended, then email
// it or send it through Stripe. Source-agnostic — rental agreements and AR
// contracts — so a source only drafts invoices and declares its holds;
// posting, sending and the sent stamps happen here.
// Spec: .ai/specs/2026-10-02-rental-invoice-automation.md,
// .ai/specs/2026-10-02-contracts.md

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { SalesInvoiceEmail } from "@carbon/documents/email";
import { createMappingService } from "@carbon/ee/accounting";
import {
  dedupeViolations,
  evaluateSalesRulesForSalesDocument
} from "@carbon/ee/rules.server";
import { SUPABASE_INTERNAL_URL, SUPABASE_URL } from "@carbon/env";
import { getDocumentType, storage } from "@carbon/files";
import { DEFAULT_FROM, sendEmail } from "@carbon/lib/email.server";
import { checkPartyContactRequirement } from "@carbon/lib/party-contact.server";
import {
  loadSalesInvoiceDocument,
  renderSalesInvoicePdf
} from "@carbon/lib/sales-invoice-document.server";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import {
  getLinkedStripeCustomerId,
  getStripeConnectAccountId,
  STRIPE_CONNECT_INTEGRATION,
  sendPostedSalesInvoiceViaStripe
} from "@carbon/stripe/send-sales-invoice.server";
import type { InvoiceAutomation } from "@carbon/utils";
import { datetime } from "@carbon/utils";
import { renderAsync } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";

const logger = getLogger("jobs", "invoice-automation");

type Client = SupabaseClient<Database>;
type SalesInvoiceStatus = Database["public"]["Enums"]["salesInvoiceStatus"];

export const INVOICE_SEND_NO_EMAIL = "The invoice contact has no email";
export const INVOICE_SEND_NOT_CONFIGURED = "Email sending is not configured";
export const INVOICE_SEND_NO_STRIPE = "No Stripe customer is linked";
export const INVOICE_SEND_STRIPE_NOT_CONNECTED = "Stripe is not connected";
export const INVOICE_POST_INTERRUPTED =
  "Posting was interrupted — the invoice is still Pending";

/** A posted invoice: anything past Draft/Pending that was not voided. */
export function isPostedSalesInvoice(status: SalesInvoiceStatus | null) {
  return (
    status !== null &&
    status !== "Draft" &&
    status !== "Pending" &&
    status !== "Voided"
  );
}

export type PostOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "held"; reason: string }
  | { outcome: "posted" };

export type EmailOutcome =
  | { emailed: true; sentTo: string }
  | { emailed: false; sendError?: string };

/** The contract an invoice was drafted from, or null. */
async function getInvoiceContractId(
  client: Client,
  companyId: string,
  invoiceId: string
): Promise<string | null> {
  const invoice = await client
    .from("salesInvoice")
    .select("customerContractId")
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (invoice.error) throw new Error(invoice.error.message);
  return invoice.data?.customerContractId ?? null;
}

/** The rental agreement an invoice bills, or null. */
async function getInvoiceRentalAgreementId(
  client: Client,
  companyId: string,
  invoiceId: string
): Promise<string | null> {
  const line = await client
    .from("salesInvoiceLine")
    .select("rentalAgreementId")
    .eq("invoiceId", invoiceId)
    .eq("companyId", companyId)
    .not("rentalAgreementId", "is", null)
    .limit(1)
    .maybeSingle();
  if (line.error) throw new Error(line.error.message);
  return line.data?.rentalAgreementId ?? null;
}

/**
 * The automation mode for an invoice: its recurring source's effective mode —
 * the contract's when it was drafted from one, else its rental agreement's.
 * Null when the invoice has no recurring source (nothing to automate).
 */
export async function resolveInvoiceAutomation(
  client: Client,
  companyId: string,
  invoiceId: string
): Promise<InvoiceAutomation | null> {
  const customerContractId = await getInvoiceContractId(
    client,
    companyId,
    invoiceId
  );
  if (customerContractId) {
    const contract = await client
      .from("customerContracts")
      .select("effectiveInvoiceAutomation")
      .eq("id", customerContractId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (contract.error) throw new Error(contract.error.message);
    return contract.data?.effectiveInvoiceAutomation ?? null;
  }

  const rentalAgreementId = await getInvoiceRentalAgreementId(
    client,
    companyId,
    invoiceId
  );
  if (!rentalAgreementId) return null;

  const agreement = await client
    .from("rentalAgreements")
    .select("effectiveInvoiceAutomation")
    .eq("id", rentalAgreementId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (agreement.error) throw new Error(agreement.error.message);
  return agreement.data?.effectiveInvoiceAutomation ?? null;
}

/** A drafted recurring invoice that invoice automation still has to run. */
export type InvoiceToAutomate = {
  invoiceId: string;
  /** The rental agreement or customer contract it was drafted from. */
  sourceId: string;
  mode: InvoiceAutomation;
};

/**
 * Every invoice the daily recurring-billing job drafted that automation has
 * not finished with: the company's Draft (or Pending — a claim left by a
 * crashed post, reported as held) invoices created by the job (`system`),
 * with no hold, from a recurring source whose effective mode is not Draft
 * Only. Read from the database rather than from the drafting step's result,
 * so drafts from an earlier attempt — a retried step drafts nothing new, a
 * failed one returns nothing — are still automated. A posted or held invoice
 * leaves the set, so each is automated once.
 */
export async function findInvoicesToAutomate(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<InvoiceToAutomate[]> {
  const invoices = await db
    .selectFrom("salesInvoice as si")
    .leftJoin("customerContracts as cc", (join) =>
      join
        .onRef("cc.id", "=", "si.customerContractId")
        .on("cc.companyId", "=", companyId)
    )
    .select((eb) => [
      "si.id",
      "si.customerContractId",
      "cc.effectiveInvoiceAutomation as contractMode",
      // An invoice bills one agreement; the contract wins when both are set,
      // as in resolveInvoiceAutomation.
      eb
        .selectFrom("salesInvoiceLine as sil")
        .select("sil.rentalAgreementId")
        .whereRef("sil.invoiceId", "=", "si.id")
        .where("sil.companyId", "=", companyId)
        .where("sil.rentalAgreementId", "is not", null)
        .orderBy("sil.rentalAgreementId")
        .limit(1)
        .as("rentalAgreementId")
    ])
    .where("si.companyId", "=", companyId)
    .where("si.createdBy", "=", "system")
    .where("si.status", "in", ["Draft", "Pending"])
    .where("si.automationHoldReason", "is", null)
    // The retry / catch-up window only. An older draft was left for review
    // (Draft Only at the time, or a person's choice) and is not posted just
    // because the source's mode has changed since.
    .where("si.createdAt", ">=", sql<string>`now() - interval '3 days'`)
    .orderBy("si.id")
    .execute();

  const agreementIds = [
    ...new Set(
      invoices
        .filter((i) => !i.customerContractId && i.rentalAgreementId)
        .map((i) => i.rentalAgreementId as string)
    )
  ];
  const agreements =
    agreementIds.length > 0
      ? await db
          .selectFrom("rentalAgreements")
          .select(["id", "effectiveInvoiceAutomation"])
          .where("companyId", "=", companyId)
          .where("id", "in", agreementIds)
          .execute()
      : [];
  const agreementMode = new Map(
    agreements.map((a) => [a.id, a.effectiveInvoiceAutomation])
  );

  const result: InvoiceToAutomate[] = [];
  for (const invoice of invoices) {
    const sourceId = invoice.customerContractId ?? invoice.rentalAgreementId;
    if (!sourceId) continue;
    const mode = invoice.customerContractId
      ? invoice.contractMode
      : agreementMode.get(sourceId);
    if (!mode || mode === "Draft Only") continue;
    result.push({ invoiceId: invoice.id, sourceId, mode });
  }
  return result;
}

async function holdInvoice(
  client: Client,
  companyId: string,
  invoiceId: string,
  reason: string
) {
  const held = await client
    .from("salesInvoice")
    .update({ automationHoldReason: reason })
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .eq("status", "Draft");
  if (held.error) {
    logger.error("Failed to record an invoice hold", {
      companyId,
      invoiceId,
      error: held.error
    });
  }
}

/**
 * Posts a Draft invoice the way the ERP's post route does — the party-contact
 * requirement, then the sales rules, then the post-sales-invoice server function — but with
 * no one to ask: anything the route would stop on becomes a hold
 * (`automationHoldReason`) and the invoice stays Draft for a person. Safe to
 * retry: an already-posted invoice is reported as posted, and only a Draft
 * can be claimed.
 */
export async function postSalesInvoiceUnattended(args: {
  client: Client;
  db: Kysely<KyselyDatabase>;
  companyId: string;
  invoiceId: string;
}): Promise<PostOutcome> {
  const { client, db, companyId, invoiceId } = args;

  const invoice = await client
    .from("salesInvoice")
    .select("status, automationHoldReason, customerId")
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (invoice.error) throw new Error(invoice.error.message);
  if (!invoice.data) return { outcome: "skipped", reason: "Invoice not found" };
  if (isPostedSalesInvoice(invoice.data.status)) return { outcome: "posted" };
  // A claim nobody finished: a poster crashed between claiming the invoice
  // and posting it (or is still posting it). Never re-claimed here — that
  // could post twice — but reported, so a person looks at it.
  if (invoice.data.status === "Pending") {
    return { outcome: "held", reason: INVOICE_POST_INTERRUPTED };
  }
  if (invoice.data.status !== "Draft") {
    return {
      outcome: "skipped",
      reason: `Invoice is ${invoice.data.status}`
    };
  }
  if (invoice.data.automationHoldReason) {
    return { outcome: "held", reason: invoice.data.automationHoldReason };
  }

  const contactError = await checkPartyContactRequirement(client, companyId, {
    kind: "customer",
    id: invoice.data.customerId
  });
  if (contactError) {
    await holdInvoice(client, companyId, invoiceId, contactError);
    return { outcome: "held", reason: contactError };
  }

  let ruleHold: string | null = null;
  try {
    const result = await evaluateSalesRulesForSalesDocument({
      client,
      companyId,
      userId: "system",
      documentType: "salesInvoice",
      documentId: invoiceId
    });
    const violations = dedupeViolations(result.violations);
    if (violations.length > 0) {
      ruleHold = `Sales rule: ${violations.map((v) => v.message).join("; ")}`;
    }
  } catch (error) {
    logger.error("Sales rule evaluation failed", {
      companyId,
      invoiceId,
      error
    });
    ruleHold = `Sales rule evaluation failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
  if (ruleHold) {
    await holdInvoice(client, companyId, invoiceId, ruleHold);
    return { outcome: "held", reason: ruleHold };
  }

  // Claim: only one poster wins a Draft.
  const claimed = await client
    .from("salesInvoice")
    .update({ status: "Pending" })
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .select("id")
    .maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) {
    return { outcome: "skipped", reason: "Invoice is no longer Draft" };
  }

  // No user is behind an automated post: the job is the system actor.
  let postError: string | undefined;
  try {
    const posted = await serverFns
      .system({ db, companyId, userId: "system" })
      .invoke("post-sales-invoice", { invoiceId });
    if (posted.error) postError = posted.error.message || "Posting failed";
  } catch (error) {
    postError = error instanceof Error ? error.message : String(error);
  }

  // The stored status is the truth: a lost response can still have posted.
  const observed = await client
    .from("salesInvoice")
    .select("status")
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (isPostedSalesInvoice(observed.data?.status ?? null)) {
    await raiseMoment("invoicing.salesInvoicePosted", {
      outputs: { salesInvoice: { id: invoiceId }, postedBy: { id: "system" } },
      companyId,
      actorId: null
    });
    return { outcome: "posted" };
  }

  // Not posted. The server function resets a failed post to Draft itself; put
  // back a claim it left Pending too, and say why on the invoice.
  const reason = postError ?? observed.error?.message ?? "Posting failed";
  logger.error("Unattended posting failed", { companyId, invoiceId, reason });
  const released = await client
    .from("salesInvoice")
    .update({ status: "Draft", automationHoldReason: reason })
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .in("status", ["Pending", "Draft"]);
  if (released.error) {
    logger.error("Failed to release a failed post", {
      companyId,
      invoiceId,
      error: released.error
    });
  }
  return { outcome: "held", reason };
}

/** `"<Company>" <address>`, the address taken from DEFAULT_FROM. */
export function companyFromAddress(companyName: string, defaultFrom: string) {
  const address = defaultFrom.match(/<([^>]+)>/)?.[1] ?? defaultFrom.trim();
  return `"${companyName.replace(/["\\]/g, "")}" <${address}>`;
}

/** CC: the customer's default CC, else the company's, plus the receivables
 *  mailbox — de-duplicated, never repeating the recipient. */
export function invoiceEmailCc(args: {
  to: string;
  customerDefaultCc: string[] | null;
  companyDefaultCc: string[] | null;
  receivablesEmail: string | null;
}): string[] {
  const base =
    args.customerDefaultCc && args.customerDefaultCc.length > 0
      ? args.customerDefaultCc
      : (args.companyDefaultCc ?? []);
  const all = [
    ...base,
    ...(args.receivablesEmail ? [args.receivablesEmail] : [])
  ]
    .map((email) => email.trim())
    .filter(Boolean);
  const seen = new Set([args.to.toLowerCase()]);
  return all.filter((email) => {
    const key = email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A storage-safe file name: no path separators or reserved characters. */
function storageFileName(fileName: string) {
  return fileName.replace(/[\\/:*?"<>|]/g, "").trim();
}

/** The send error for an invoice that went out but whose sent stamp failed. */
export const invoiceSentStampFailed = (sentTo: string, error: string) =>
  `Sent to ${sentTo}, but recording the send failed: ${error}`;

async function stampSendError(
  client: Client,
  companyId: string,
  invoiceId: string,
  sendError: string
): Promise<EmailOutcome> {
  const stamped = await client
    .from("salesInvoice")
    .update({ sendError })
    .eq("id", invoiceId)
    .eq("companyId", companyId);
  if (stamped.error) {
    logger.error("Failed to record an invoice send error", {
      companyId,
      invoiceId,
      error: stamped.error
    });
  }
  return { emailed: false, sendError };
}

/** The recurring source's owner — the contract's or agreement's salesperson,
 *  else its creator. Best-effort: only a Reply-To fallback, so a failed read
 *  is null rather than a failed send. */
async function getInvoiceOwnerEmail(
  client: Client,
  companyId: string,
  invoiceId: string
): Promise<string | null> {
  try {
    return await readInvoiceOwnerEmail(client, companyId, invoiceId);
  } catch (error) {
    logger.error("Failed to read the invoice owner", {
      companyId,
      invoiceId,
      error
    });
    return null;
  }
}

async function readInvoiceOwnerEmail(
  client: Client,
  companyId: string,
  invoiceId: string
): Promise<string | null> {
  const customerContractId = await getInvoiceContractId(
    client,
    companyId,
    invoiceId
  );
  let source: { salesPersonId: string | null; createdBy: string } | null = null;
  if (customerContractId) {
    const contract = await client
      .from("customerContract")
      .select("salesPersonId, createdBy")
      .eq("id", customerContractId)
      .eq("companyId", companyId)
      .maybeSingle();
    source = contract.data;
  } else {
    const rentalAgreementId = await getInvoiceRentalAgreementId(
      client,
      companyId,
      invoiceId
    );
    if (!rentalAgreementId) return null;
    const agreement = await client
      .from("rentalAgreement")
      .select("salesPersonId, createdBy")
      .eq("id", rentalAgreementId)
      .eq("companyId", companyId)
      .maybeSingle();
    source = agreement.data;
  }
  const ownerId = source?.salesPersonId ?? source?.createdBy;
  if (!ownerId || ownerId === "system") return null;
  const user = await client
    .from("user")
    .select("email")
    .eq("id", ownerId)
    .maybeSingle();
  return user.data?.email || null;
}

/**
 * Emails a posted invoice to its invoice contact with the PDF attached, From
 * the company's name at the platform address and Reply-To the receivables
 * mailbox (else the agreement's owner). Stamps `sentAt`/`sentTo` on success
 * and `sendError` on any failure, so a failed send shows in Needs Review.
 * Idempotent: an invoice with `sentAt` is never sent twice.
 */
export async function emailPostedInvoice(args: {
  client: Client;
  companyId: string;
  invoiceId: string;
}): Promise<EmailOutcome> {
  const { client, companyId, invoiceId } = args;

  const invoice = await client
    .from("salesInvoice")
    .select(
      "sentAt, status, invoiceCustomerContactId, customerId, opportunityId, invoiceId"
    )
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (invoice.error) throw new Error(invoice.error.message);
  if (!invoice.data || invoice.data.sentAt) return { emailed: false };
  if (!isPostedSalesInvoice(invoice.data.status)) return { emailed: false };

  const contact = invoice.data.invoiceCustomerContactId
    ? await client
        .from("customerContact")
        .select("contact(email, firstName, lastName)")
        .eq("id", invoice.data.invoiceCustomerContactId)
        .eq("companyId", companyId)
        .maybeSingle()
    : null;
  const recipient = contact?.data?.contact;
  if (!recipient?.email) {
    return stampSendError(client, companyId, invoiceId, INVOICE_SEND_NO_EMAIL);
  }

  try {
    const [company, settings, customer, ownerEmail] = await Promise.all([
      client
        .from("company")
        .select("name, companyGroupId")
        .eq("id", companyId)
        .single(),
      client
        .from("companySettings")
        .select("accountsReceivableEmail, defaultCustomerCc")
        .eq("id", companyId)
        .single(),
      client
        .from("customer")
        .select("defaultCc")
        .eq("id", invoice.data.customerId)
        .eq("companyId", companyId)
        .maybeSingle(),
      getInvoiceOwnerEmail(client, companyId, invoiceId)
    ]);
    if (company.error) throw new Error(company.error.message);
    if (!company.data.companyGroupId) {
      throw new Error("The company has no company group");
    }

    // The PDF is rendered here, so its logo is fetched from the internal URL.
    const document = await loadSalesInvoiceDocument({
      client,
      companyId,
      companyGroupId: company.data.companyGroupId,
      invoiceId,
      locale: "en-US",
      storageUrl: SUPABASE_INTERNAL_URL ?? ""
    });
    const pdf = await renderSalesInvoicePdf(document.pdfProps);

    const path = `${companyId}/${
      invoice.data.opportunityId
        ? `opportunity/${invoice.data.opportunityId}`
        : `sales-invoice/${invoiceId}`
    }/${storageFileName(document.fileName)}`;
    const upload = await storage(client)
      .company(companyId)
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (upload.error) throw new Error(upload.error.message);

    const documentRow = await client.from("document").insert({
      path,
      name: document.fileName,
      size: Math.round(pdf.byteLength / 1024),
      type: getDocumentType(document.fileName),
      sourceDocument: "Sales Invoice",
      sourceDocumentId: invoiceId,
      readGroups: ["system"],
      writeGroups: ["system"],
      createdBy: "system",
      companyId
    });
    if (documentRow.error) {
      // The email still goes out; only the copy on the invoice is missing.
      logger.error("Failed to record the sent invoice PDF", {
        companyId,
        invoiceId,
        error: documentRow.error
      });
    }

    const receivablesEmail = settings.data?.accountsReceivableEmail || null;
    const replyTo = receivablesEmail ?? ownerEmail ?? undefined;
    const cc = invoiceEmailCc({
      to: recipient.email,
      customerDefaultCc: customer.data?.defaultCc ?? null,
      companyDefaultCc: settings.data?.defaultCustomerCc ?? null,
      receivablesEmail
    });

    // The email is read in the recipient's mail client: its logo must use
    // the public URL, not the internal one the PDF was rendered with.
    const publicCompany = { ...document.email.company };
    if (SUPABASE_INTERNAL_URL && SUPABASE_URL) {
      for (const field of [
        "logoLight",
        "logoDark",
        "logoLightIcon",
        "logoDarkIcon",
        "logoWatermark"
      ] as const) {
        const value = publicCompany[field];
        if (typeof value === "string") {
          publicCompany[field] = value.replace(
            SUPABASE_INTERNAL_URL,
            SUPABASE_URL
          );
        }
      }
    }

    const template = SalesInvoiceEmail({
      ...document.email,
      company: publicCompany,
      locale: "en-US",
      recipient: {
        email: recipient.email,
        firstName: recipient.firstName ?? undefined,
        lastName: recipient.lastName ?? undefined
      },
      sender: {
        email: replyTo ?? "",
        firstName: company.data.name,
        lastName: ""
      }
    });
    const html = await renderAsync(template);
    const text = await renderAsync(template, { plainText: true });

    const sent = await sendEmail({
      from: companyFromAddress(company.data.name, DEFAULT_FROM),
      to: recipient.email,
      cc: cc.length > 0 ? cc : undefined,
      replyTo,
      subject: `Invoice ${document.invoiceReadableId} from ${company.data.name}`,
      html,
      text,
      attachments: [
        { filename: document.fileName, content: pdf.toString("base64") }
      ]
    });
    if (sent.error) {
      return stampSendError(client, companyId, invoiceId, sent.error.message);
    }
    // No transport: nothing left the building, so it is not "sent".
    if (!sent.data) {
      return stampSendError(
        client,
        companyId,
        invoiceId,
        INVOICE_SEND_NOT_CONFIGURED
      );
    }

    const sentTo = [recipient.email, ...cc].join(", ");
    const stamped = await client
      .from("salesInvoice")
      .update({ sentAt: datetime.timestamp(), sentTo, sendError: null })
      .eq("id", invoiceId)
      .eq("companyId", companyId);
    if (stamped.error) {
      // The email went out, but without `sentAt` the invoice reads as unsent
      // and a Send would email it again: say so on the invoice instead of
      // reporting a clean send.
      logger.error("Invoice emailed but the sent stamp failed", {
        companyId,
        invoiceId,
        error: stamped.error
      });
      return stampSendError(
        client,
        companyId,
        invoiceId,
        invoiceSentStampFailed(sentTo, stamped.error.message)
      );
    }
    return { emailed: true, sentTo };
  } catch (error) {
    logger.error("Emailing a posted invoice failed", {
      companyId,
      invoiceId,
      error
    });
    return stampSendError(
      client,
      companyId,
      invoiceId,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Sends a posted invoice through the company's connected Stripe account to
 * the billing customer's linked Stripe customer, which emails it with a
 * payment link. Stamps `sentAt`/`sentTo: "Stripe"` on success and
 * `sendError` on any failure, so a failed send shows in Needs Review.
 * Idempotent: an invoice with `sentAt`, or already linked to a Stripe
 * invoice, is never sent twice. An invoice totalling zero or less has nothing
 * to collect: it is left unsent with no send error.
 */
export async function sendPostedInvoiceViaStripe(args: {
  client: Client;
  db: Kysely<KyselyDatabase>;
  companyId: string;
  invoiceId: string;
}): Promise<EmailOutcome> {
  const { client, db, companyId, invoiceId } = args;

  // The view, for its `totalAmount`; `baseStatus` is the stored status.
  const invoice = await client
    .from("salesInvoices")
    .select("sentAt, baseStatus, customerId, invoiceCustomerId, totalAmount")
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (invoice.error) throw new Error(invoice.error.message);
  if (!invoice.data || invoice.data.sentAt) return { emailed: false };
  if (!isPostedSalesInvoice(invoice.data.baseStatus)) return { emailed: false };
  // Nothing to collect: Stripe cannot send a zero (or credit) invoice, and
  // trying would hold a correctly posted invoice in Needs Review. Not sent,
  // with no send error — the digest counts it as posted.
  if ((invoice.data.totalAmount ?? 0) <= 0) return { emailed: false };

  const stampSent = async () => {
    const stamped = await client
      .from("salesInvoice")
      .update({
        sentAt: datetime.timestamp(),
        sentTo: "Stripe",
        sendError: null
      })
      .eq("id", invoiceId)
      .eq("companyId", companyId);
    if (stamped.error) {
      // A Send retry is safe here — the linked Stripe invoice stops a second
      // send — but the invoice must not read as cleanly sent.
      logger.error("Invoice sent via Stripe but the sent stamp failed", {
        companyId,
        invoiceId,
        error: stamped.error
      });
      return stampSendError(
        client,
        companyId,
        invoiceId,
        invoiceSentStampFailed("Stripe", stamped.error.message)
      );
    }
    return { emailed: true, sentTo: "Stripe" } as const;
  };

  try {
    // A Stripe invoice already linked means an earlier attempt sent it and
    // only the stamp was lost: a second send would bill the customer twice.
    const linked = await client
      .from("externalIntegrationMapping")
      .select("externalId")
      .eq("entityType", "salesInvoice")
      .eq("entityId", invoiceId)
      .eq("integration", STRIPE_CONNECT_INTEGRATION)
      .eq("companyId", companyId)
      .maybeSingle();
    if (linked.error) throw new Error(linked.error.message);
    if (linked.data?.externalId) return stampSent();

    const stripeAccountId = await getStripeConnectAccountId(client, companyId);
    if (!stripeAccountId) {
      return stampSendError(
        client,
        companyId,
        invoiceId,
        INVOICE_SEND_STRIPE_NOT_CONNECTED
      );
    }

    // The view types every column nullable; the table's `customerId` is not.
    const billingCustomerId =
      invoice.data.invoiceCustomerId ?? invoice.data.customerId;
    const stripeCustomerId = billingCustomerId
      ? await getLinkedStripeCustomerId(client, companyId, billingCustomerId)
      : null;
    if (!stripeCustomerId) {
      return stampSendError(
        client,
        companyId,
        invoiceId,
        INVOICE_SEND_NO_STRIPE
      );
    }

    await sendPostedSalesInvoiceViaStripe({
      serviceRole: client,
      companyId,
      userId: "system",
      invoiceId,
      stripeAccountId,
      stripeCustomerId,
      linkStripeInvoice: (stripeInvoiceId, metadata) =>
        createMappingService(db, companyId).link(
          "salesInvoice",
          invoiceId,
          STRIPE_CONNECT_INTEGRATION,
          stripeInvoiceId,
          { metadata }
        )
    });
    return stampSent();
  } catch (error) {
    logger.error("Sending a posted invoice via Stripe failed", {
      companyId,
      invoiceId,
      error
    });
    return stampSendError(
      client,
      companyId,
      invoiceId,
      error instanceof Error ? error.message : String(error)
    );
  }
}
