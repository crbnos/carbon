// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, SUPABASE_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { SalesInvoiceEmail } from "@carbon/documents/email";
import { createMappingService } from "@carbon/ee/accounting";
import {
  dedupeViolations,
  evaluateSalesRulesForSalesDocument,
  isBlocked
} from "@carbon/ee/rules.server";
import { storage } from "@carbon/files";
import { validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import {
  loadSalesInvoiceDocument,
  renderSalesInvoicePdf,
  type SalesInvoiceDocument
} from "@carbon/lib/sales-invoice-document.server";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import {
  expectedConnectInvoiceTotal,
  retrieveConnectCustomer,
  upsertConnectCustomer
} from "@carbon/stripe/connect.server";
import {
  sendPostedSalesInvoiceViaStripe,
  toStripeInvoiceLines
} from "@carbon/stripe/send-sales-invoice.server";
import { datetime } from "@carbon/utils";
import { renderAsync } from "@react-email/components";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import type { ActionFunctionArgs } from "react-router";
import { upsertDocument } from "~/modules/documents";
import {
  getSalesInvoice,
  getSalesInvoiceLines,
  getSalesInvoiceShipment,
  salesInvoicePostValidator,
  type stripeCustomerActions
} from "~/modules/invoicing";
import {
  resolveStripeCustomer,
  STRIPE_CONNECT_INTEGRATION
} from "~/modules/invoicing/stripe-customer.server";
import { getCustomerContact, updateCustomerContact } from "~/modules/sales";
import { recordSalesRuleOutcome } from "~/modules/sales/sales.server";
import { checkPartyContactRequirement } from "~/modules/settings/party-contact.server";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { getUser } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
import { stripSpecialCharacters } from "~/utils/string";

const logger = getLogger("stripe-connect");

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

type StripeSendContext = {
  stripeAccountId: string;
  /**
   * Already resolved and linked by the preflight — by the time the send runs,
   * the customer exists on the connected account and
   * `externalIntegrationMapping` points at it.
   */
  stripeCustomerId: string;
  customerName: string;
};

/**
 * Resolve the Stripe customer this invoice will be billed to, and link it.
 *
 * Runs BEFORE the invoice is posted, so a customer that cannot be resolved
 * aborts the whole operation rather than leaving a posted invoice that was
 * never sent.
 *
 * The user's choice arrives from the post modal, but is never taken at face
 * value: `resolveStripeCustomer` is re-run here — the same function the modal
 * called — and the action is checked against what the connected account
 * actually looks like now. That closes the gap between the dialog being shown
 * and the form being submitted (a customer deleted in the Stripe dashboard, a
 * mapping written by a concurrent post, a hand-rolled form body naming someone
 * else's customer id).
 */
async function preflightStripeSend({
  serviceRole,
  companyId,
  userId,
  invoiceId,
  customerContact,
  stripeCustomerAction,
  stripeCustomerId,
  stripeContactEmail
}: {
  serviceRole: ServiceRole;
  companyId: string;
  userId: string;
  invoiceId: string;
  customerContact?: string;
  stripeCustomerAction?: (typeof stripeCustomerActions)[number];
  stripeCustomerId?: string;
  stripeContactEmail?: string;
}): Promise<
  { ok: true; context: StripeSendContext } | { ok: false; message: string }
> {
  if (!customerContact) {
    return { ok: false, message: "a customer contact is required" };
  }
  if (!stripeCustomerAction) {
    return { ok: false, message: "the Stripe customer was not confirmed" };
  }

  if (stripeContactEmail) {
    // customerContact comes from the form and the service role bypasses RLS:
    // scope it so another company's contact is never read or rewritten.
    const contact = await getCustomerContact(
      serviceRole,
      customerContact,
      companyId
    );
    if (contact.data && !contact.data.contact?.email) {
      const update = await updateCustomerContact(serviceRole, {
        contactId: contact.data.contactId,
        contact: {
          firstName: contact.data.contact?.firstName ?? "",
          lastName: contact.data.contact?.lastName ?? "",
          email: stripeContactEmail
        }
      });
      if (update.error) {
        return { ok: false, message: "the contact email could not be saved" };
      }
    }
  }

  const resolved = await resolveStripeCustomer({
    serviceRole,
    companyId,
    invoiceId,
    customerContactId: customerContact,
    emailOverride: stripeContactEmail
  });

  if (!resolved.sources) {
    return {
      ok: false,
      message:
        resolved.resolution.state === "unavailable"
          ? resolved.resolution.message
          : "the Stripe customer could not be resolved"
    };
  }

  const { stripeAccountId, billingCustomerId, sources, input } = resolved;

  if (!input) {
    return { ok: false, message: "the selected contact has no email address" };
  }

  const customerName = sources.customer.name;
  if (!customerName) {
    return { ok: false, message: "the customer could not be loaded" };
  }

  const [lines, shipment] = await Promise.all([
    getSalesInvoiceLines(serviceRole, invoiceId),
    getSalesInvoiceShipment(serviceRole, invoiceId)
  ]);

  // The same arithmetic the send itself reconciles against, so an invoice that
  // is billable only through its surcharges isn't rejected here as empty.
  const { total } = expectedConnectInvoiceTotal({
    lines: toStripeInvoiceLines(lines.data ?? []),
    shippingCost: shipment.data?.shippingCost ?? undefined
  });
  if (total <= 0) {
    return {
      ok: false,
      message: "Stripe cannot send a zero-amount invoice"
    };
  }

  const mappingService = createMappingService(getDatabaseClient(), companyId);

  let resolvedCustomerId: string;

  switch (stripeCustomerAction) {
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
        // the whole send outright.
        if ((err as { type?: string }).type !== "idempotency_error") {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        const retried = await resolveStripeCustomer({
          serviceRole,
          companyId,
          invoiceId,
          customerContactId: customerContact,
          emailOverride: stripeContactEmail
        });
        if (retried.resolution.state !== "linked") {
          throw err;
        }
        resolvedCustomerId = retried.resolution.customer.id;
      }
      break;
    }
  }

  await mappingService.link(
    "customer",
    billingCustomerId,
    STRIPE_CONNECT_INTEGRATION,
    resolvedCustomerId,
    { createdBy: userId }
  );

  return {
    ok: true,
    context: {
      stripeAccountId,
      stripeCustomerId: resolvedCustomerId,
      customerName
    }
  };
}

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "invoicing",
      role: "employee"
    });

  const { invoiceId } = params;
  if (!invoiceId) {
    return {
      success: false,
      message: "Could not find invoiceId"
    };
  }

  // Mirror of the supplier gate on the purchasing side. Off by default and
  // nothing downstream forces it today — Rillet, Xero and QuickBooks all treat a
  // customer email as optional — so this only fires for a company that has asked
  // for the policy. It exists so the two sides behave the same when they do.
  const invoiceCustomer = await client
    .from("salesInvoice")
    .select("customerId")
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .maybeSingle();

  // Fail CLOSED — see the supplier gate on the purchasing side. An unchecked
  // error left `customerId` undefined, and a party with no id is not checked at
  // all, so the read failing silently disabled the gate.
  if (invoiceCustomer.error || !invoiceCustomer.data) {
    logger.error("Could not read the invoice customer before posting", {
      companyId,
      invoiceId,
      error: invoiceCustomer.error
    });
    return { success: false, message: "Failed to post sales invoice" };
  }

  const customerContactError = await checkPartyContactRequirement(
    client,
    companyId,
    { kind: "customer", id: invoiceCustomer.data.customerId }
  );
  if (customerContactError) {
    return { success: false, message: customerContactError };
  }

  let file: Buffer;
  let fileName: string;
  let documentFilePath: string;
  let invoiceDocument: SalesInvoiceDocument;

  const serviceRole = getCarbonServiceRole();

  // Everything below reads and writes through the service role (and the
  // Stripe preflight runs before the server function re-checks the invoice), so
  // the URL's invoiceId must belong to this company before anything happens.
  await requireCompanyRecord(serviceRole, "salesInvoice", companyId, {
    id: invoiceId
  });

  const formData = await request.formData();
  const validation = await validator(salesInvoicePostValidator).validate(
    formData
  );

  if (validation.error) {
    return {
      success: false,
      message: "Invalid notification type"
    };
  }

  // Sales-rule terminal gate. Posting is the revenue checkpoint and the only
  // gate an invoice raised with no upstream document ever passes — lines can
  // arrive from the convert server function, the API, or MCP without the
  // per-line check. Re-reads the whole document, so it also catches
  // staleness (a rule authored after the lines were written). Must run
  // BEFORE the optimistic `Pending` write below, or a blocked post strands
  // the invoice in `Pending`; running first also prevents the Stripe send
  // and the customer email.
  const acknowledged = formData.get("acknowledged") === "true";
  // An evaluator throw (failed rule/item/ship-to load) must fail closed but
  // not as a raw 500 — surface it like the Stripe preflight below.
  let salesRuleResult: Awaited<
    ReturnType<typeof evaluateSalesRulesForSalesDocument>
  >;
  try {
    salesRuleResult = await evaluateSalesRulesForSalesDocument({
      client: serviceRole,
      companyId,
      userId,
      documentType: "salesInvoice",
      documentId: invoiceId
    });
  } catch (err) {
    logger.error("Sales rule evaluation failed", { error: err, invoiceId });
    return {
      success: false,
      message: `Invoice not posted — ${
        err instanceof Error ? err.message : "sales rule evaluation failed"
      }`
    };
  }
  const { ruleNames: salesRuleNames } = salesRuleResult;
  const salesRuleViolations = dedupeViolations(salesRuleResult.violations);
  if (
    salesRuleViolations.length > 0 &&
    isBlocked(salesRuleViolations, acknowledged)
  ) {
    // Record the same evidence + notification the per-line checks write —
    // posting is the revenue checkpoint, the strongest override there is.
    await recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "salesInvoice",
      documentId: invoiceId,
      outcome: "blocked",
      violations: salesRuleViolations,
      ruleNames: salesRuleNames
    });
    return {
      success: false,
      message: "Sales rules blocked posting this invoice",
      violations: salesRuleViolations,
      ruleNames: salesRuleNames
    };
  }

  const {
    notification,
    customerContact,
    cc: ccSelections,
    stripeCustomerAction,
    stripeCustomerId,
    stripeContactEmail,
    stripeDueDate
  } = validation.data;

  let stripeSendContext: StripeSendContext | null = null;
  if (notification === "Stripe") {
    // The invoice has not been posted yet at this point, so an uncaught
    // Stripe API error here must not become a raw 500 — surface it the same
    // way an ordinary preflight failure is surfaced.
    let preflight: Awaited<ReturnType<typeof preflightStripeSend>>;
    try {
      preflight = await preflightStripeSend({
        serviceRole,
        companyId,
        userId,
        invoiceId,
        customerContact,
        stripeCustomerAction,
        stripeCustomerId,
        stripeContactEmail
      });
    } catch (err) {
      logger.error("Stripe preflight failed", { error: err, invoiceId });
      return {
        success: false,
        message: `Invoice not posted — ${
          err instanceof Error ? err.message : "the Stripe preflight failed"
        }`
      };
    }

    if (!preflight.ok) {
      return {
        success: false,
        message: `Invoice not posted — ${preflight.message}`
      };
    }

    stripeSendContext = preflight.context;
  }

  // Claim: only a Draft can be posted. Invoice automation posts the same
  // invoices in the background and its claim IS a Pending row, so re-claiming
  // Pending here (as assertPostable would allow) could post twice.
  const setPendingState = await client
    .from("salesInvoice")
    .update({
      status: "Pending"
    })
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .select("id")
    .maybeSingle();

  if (setPendingState.error) {
    return {
      success: false,
      message: "Failed to update sales invoice status"
    };
  }
  if (!setPendingState.data) {
    return {
      success: false,
      message: "This invoice is no longer a draft — it may be posting already"
    };
  }

  try {
    const posted = await serverFns
      .system({ db: getDatabaseClient(), companyId, userId })
      .invoke("post-sales-invoice", { invoiceId });

    if (posted.error) {
      await client
        .from("salesInvoice")
        .update({
          status: "Draft"
        })
        .eq("id", invoiceId);

      return {
        success: false,
        message: "Failed to post sales invoice"
      };
    }
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  } catch (err) {
    await client
      .from("salesInvoice")
      .update({
        status: "Draft"
      })
      .eq("id", invoiceId);

    return {
      success: false,
      message: "Failed to post sales invoice"
    };
  }

  // Acknowledged-override evidence only once the post has committed — a
  // trail (and notification) for a post that then failed would be false, and
  // a retry would duplicate it.
  if (salesRuleViolations.length > 0) {
    await recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "salesInvoice",
      documentId: invoiceId,
      outcome: "acknowledged",
      violations: salesRuleViolations,
      ruleNames: salesRuleNames
    });
  }

  const salesInvoice = await getSalesInvoice(serviceRole, invoiceId);
  if (salesInvoice.error) {
    return {
      success: false,
      message: "Failed to get sales invoice"
    };
  }

  if (salesInvoice.data.companyId !== companyId) {
    return {
      success: false,
      message: "You are not authorized to confirm this sales invoice"
    };
  }

  // Must stay below the tenant guard and the rollback catch above — a post that
  // got reverted to Draft must not fire workflows.
  await raiseMoment("invoicing.salesInvoicePosted", {
    outputs: { salesInvoice: { id: invoiceId }, postedBy: { id: userId } },
    companyId,
    actorId: userId
  });

  trackWorkEvent("sales_invoice_posted", {
    companyId,
    userId,
    salesInvoiceId: invoiceId
  });

  const acceptLanguage = request.headers.get("accept-language");
  const locales = parseAcceptLanguage(acceptLanguage, {
    validate: Intl.DateTimeFormat.supportedLocalesOf
  });

  try {
    invoiceDocument = await loadSalesInvoiceDocument({
      client: serviceRole,
      companyId,
      companyGroupId,
      invoiceId,
      locale: locales?.[0] ?? "en-US",
      storageUrl: SUPABASE_URL ?? ""
    });

    file = await renderSalesInvoicePdf(invoiceDocument.pdfProps);
    fileName = stripSpecialCharacters(
      `${salesInvoice.data.invoiceId} - ${new Date()
        .toISOString()
        .slice(0, -5)}.pdf`
    );

    const { opportunityId } = salesInvoice.data;
    documentFilePath = `${companyId}/${opportunityId ? `opportunity/${opportunityId}` : `sales-invoice/${invoiceId}`}/${fileName}`;

    const documentFileUpload = await storage(serviceRole)
      .company(companyId)
      .upload(documentFilePath, file, {
        cacheControl: `${12 * 60 * 60}`,
        contentType: "application/pdf",
        upsert: true
      });

    if (documentFileUpload.error) {
      return {
        success: false,
        message: "Failed to upload file"
      };
    }

    const createDocument = await upsertDocument(serviceRole, {
      path: documentFilePath,
      name: fileName,
      size: Math.round(file.byteLength / 1024),
      sourceDocument: "Sales Invoice",
      sourceDocumentId: invoiceId,
      readGroups: [userId],
      writeGroups: [userId],
      createdBy: userId,
      companyId
    });

    if (createDocument.error) {
      return {
        success: false,
        message: "Failed to create document"
      };
    }
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  } catch (err) {
    return {
      success: false,
      message: "Failed to generate PDF"
    };
  }

  switch (notification) {
    case "Email":
      try {
        if (!customerContact) {
          return {
            success: false,
            message: "Customer contact is required"
          };
        }

        const [customer, seller] = await Promise.all([
          getCustomerContact(serviceRole, customerContact, companyId),
          getUser(serviceRole, userId)
        ]);

        if (!customer?.data?.contact) {
          return {
            success: false,
            message: "Failed to get customer contact"
          };
        }
        if (!seller.data) {
          return {
            success: false,
            message: "Failed to get user"
          };
        }

        // The same reads the PDF above rendered from.
        const emailTemplate = SalesInvoiceEmail({
          ...invoiceDocument.email,
          locale: locales?.[0] ?? "en-US",
          recipient: {
            // @ts-expect-error TS2322 - TODO: fix type
            email: customer.data.contact.email,
            firstName: customer.data.contact.firstName ?? undefined,
            lastName: customer.data.contact.lastName ?? undefined
          },
          sender: {
            email: seller.data.email,
            firstName: seller.data.firstName,
            lastName: seller.data.lastName
          }
        });

        const html = await renderAsync(emailTemplate);
        const text = await renderAsync(emailTemplate, { plainText: true });
        const signed = await storage(serviceRole)
          .company(companyId)
          .createSignedUrl(documentFilePath, 3600);
        if (signed.error) {
          logger.error("Failed to create signed URL for attachment", {
            storagePath: documentFilePath,
            error: signed.error
          });
        }

        await trigger("send-email", {
          to: [seller.data.email, customer.data.contact.email!],
          cc: ccSelections?.length ? ccSelections : undefined,
          from: seller.data.email,
          subject: `Invoice ${invoiceDocument.invoiceReadableId} from ${invoiceDocument.email.company.name}`,
          html,
          text,
          attachments: signed.data
            ? [
                {
                  path: signed.data.signedUrl,
                  filename: fileName
                }
              ]
            : undefined,
          companyId
        });

        // trigger() only queues the email, so sentAt here means "queued".
        const sentStamp = await serviceRole
          .from("salesInvoice")
          .update({
            sentAt: datetime.timestamp(),
            sentTo: [customer.data.contact.email, ...(ccSelections ?? [])]
              .filter(Boolean)
              .join(", "),
            sendError: null
          })
          .eq("id", invoiceId)
          .eq("companyId", companyId);
        if (sentStamp.error) {
          logger.error("Failed to stamp sales invoice as sent", {
            companyId,
            invoiceId,
            error: sentStamp.error
          });
        }
      } catch (err) {
        logger.error("Failed to send sales invoice email", {
          companyId,
          invoiceId,
          error: err
        });
        const errorStamp = await serviceRole
          .from("salesInvoice")
          .update({ sendError: "Failed to send email" })
          .eq("id", invoiceId)
          .eq("companyId", companyId);
        if (errorStamp.error) {
          logger.error("Failed to stamp sales invoice send error", {
            companyId,
            invoiceId,
            error: errorStamp.error
          });
        }
        return {
          success: false,
          message: "Failed to send email"
        };
      }
      break;
    case "Stripe": {
      try {
        if (!stripeSendContext) {
          return {
            success: false,
            message: "Invoice posted, but the Stripe send was not prepared"
          };
        }

        // Resolved, confirmed by the user, and linked in the preflight — by
        // here the customer is known to exist on the connected account.
        const { stripeAccountId, stripeCustomerId } = stripeSendContext;

        await sendPostedSalesInvoiceViaStripe({
          serviceRole,
          companyId,
          userId,
          invoiceId,
          stripeAccountId,
          stripeCustomerId,
          dueDateOverride: stripeDueDate,
          linkStripeInvoice: (stripeInvoiceId, metadata) =>
            createMappingService(getDatabaseClient(), companyId).link(
              "salesInvoice",
              invoiceId,
              STRIPE_CONNECT_INTEGRATION,
              stripeInvoiceId,
              { metadata }
            )
        });
      } catch (err) {
        logger.error("Failed to send sales invoice via Stripe", {
          error: err,
          invoiceId
        });
        return {
          success: false,
          message: `Invoice posted, but failed to send via Stripe: ${
            err instanceof Error ? err.message : "unknown error"
          }`
        };
      }

      return {
        success: true,
        message: "Invoice posted and sent via Stripe"
      };
    }
    case undefined:
    case "None":
      break;
    default:
      return {
        success: false,
        message: "Invalid notification type"
      };
  }

  return {
    success: true,
    message: "Sales invoice confirmed"
  };
}
