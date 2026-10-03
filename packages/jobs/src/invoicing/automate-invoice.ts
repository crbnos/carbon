// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Invoice automation: post a drafted recurring invoice unattended, then email
// it. Source-agnostic — rental agreements today, AR contracts later — so a
// source only drafts invoices and declares its holds; posting, sending and
// the sent stamps happen here.
// Spec: .ai/specs/2026-10-02-rental-invoice-automation.md

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { InvoiceAutomation } from "@carbon/database/rental-invoice-plan";
import { SalesInvoiceEmail } from "@carbon/documents/email";
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
import { datetime } from "@carbon/utils";
import { renderAsync } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";

const logger = getLogger("jobs", "invoice-automation");

type Client = SupabaseClient<Database>;
type SalesInvoiceStatus = Database["public"]["Enums"]["salesInvoiceStatus"];

export const INVOICE_SEND_NO_EMAIL = "The invoice contact has no email";
export const INVOICE_SEND_NOT_CONFIGURED = "Email sending is not configured";

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

/**
 * The automation mode for an invoice: its recurring source's effective mode.
 * Null when the invoice has no recurring source (nothing to automate).
 */
export async function resolveInvoiceAutomation(
  client: Client,
  companyId: string,
  invoiceId: string
): Promise<InvoiceAutomation | null> {
  const line = await client
    .from("salesInvoiceLine")
    .select("rentalAgreementId")
    .eq("invoiceId", invoiceId)
    .eq("companyId", companyId)
    .not("rentalAgreementId", "is", null)
    .limit(1)
    .maybeSingle();
  if (line.error) throw new Error(line.error.message);
  if (!line.data?.rentalAgreementId) return null;

  const agreement = await client
    .from("rentalAgreements")
    .select("effectiveInvoiceAutomation")
    .eq("id", line.data.rentalAgreementId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (agreement.error) throw new Error(agreement.error.message);
  return agreement.data?.effectiveInvoiceAutomation ?? null;
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

/** The recurring source's owner: the agreement's salesperson, else its creator. */
async function getInvoiceOwnerEmail(
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
  if (!line.data?.rentalAgreementId) return null;
  const agreement = await client
    .from("rentalAgreement")
    .select("salesPersonId, createdBy")
    .eq("id", line.data.rentalAgreementId)
    .eq("companyId", companyId)
    .maybeSingle();
  const ownerId = agreement.data?.salesPersonId ?? agreement.data?.createdBy;
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

    // The PDF is rendered here, so its logo is fetched from the internal URL.
    const document = await loadSalesInvoiceDocument({
      client,
      companyId,
      companyGroupId: company.data.companyGroupId ?? "",
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
      logger.error("Invoice emailed but the sent stamp failed", {
        companyId,
        invoiceId,
        error: stamped.error
      });
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
