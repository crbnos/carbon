import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { SalesInvoiceEmail } from "@carbon/documents/email";
import { createMappingService } from "@carbon/ee/accounting";
import { validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import type { ConnectInvoiceLineInput } from "@carbon/stripe/connect.server";
import {
  createAndSendConnectInvoice,
  expectedConnectInvoiceTotal,
  retrieveConnectCustomer,
  upsertConnectCustomer
} from "@carbon/stripe/connect.server";
import { datetime } from "@carbon/utils";
import { parseDate, Time, toCalendarDateTime } from "@internationalized/date";
import { renderAsync } from "@react-email/components";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import type { ActionFunctionArgs } from "react-router";
import { getCurrencyByCode, getPaymentTermsList } from "~/modules/accounting";
import { upsertDocument } from "~/modules/documents";
import {
  getSalesInvoice,
  getSalesInvoiceCustomerDetails,
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
import { getCompany } from "~/modules/settings";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getUser } from "~/modules/users/users.server";
import { loader as pdfLoader } from "~/routes/file+/sales-invoice+/$id[.]pdf";
import { getDatabaseClient } from "~/services/database.server";
import { stripSpecialCharacters } from "~/utils/string";

const logger = getLogger("stripe-connect");

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

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

  const upload = await serviceRole.storage
    .from("private")
    .upload(filePath, file, {
      cacheControl: `${12 * 60 * 60}`,
      contentType: "application/pdf",
      upsert: true
    });

  if (upload.error) {
    throw new Error("Failed to upload Stripe invoice PDF");
  }

  const document = await upsertDocument(serviceRole, {
    path: filePath,
    name: fileName,
    size: Math.round(file.byteLength / 1024),
    sourceDocument: "Sales Invoice",
    sourceDocumentId: invoiceId,
    readGroups: [userId],
    writeGroups: [userId],
    createdBy: userId,
    companyId
  });

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

type SalesInvoiceLineRow = NonNullable<
  Awaited<ReturnType<typeof getSalesInvoiceLines>>["data"]
>[number];

/**
 * Carbon invoice lines → the Stripe mapping's line input.
 *
 * Comment lines carry no money and exist only to annotate the printed invoice,
 * so they are dropped rather than sent as zero-amount items. Every other field
 * is passed through untouched — in particular `taxPercent` stays the fraction
 * the column stores, and the `converted*` mirrors are ignored because Stripe
 * bills in the invoice's own currency, not the company's base currency.
 */
function toStripeInvoiceLines(
  lines: SalesInvoiceLineRow[]
): ConnectInvoiceLineInput[] {
  return lines
    .filter((line) => line.invoiceLineType !== "Comment")
    .map((line) => ({
      description: line.description ?? line.itemReadableId ?? "Item",
      quantity: line.quantity ?? 0,
      unitPrice: line.unitPrice ?? 0,
      addOnCost: line.addOnCost ?? 0,
      shippingCost: line.shippingCost ?? 0,
      nonTaxableAddOnCost: line.nonTaxableAddOnCost ?? 0,
      taxPercent: line.taxPercent ?? 0,
      unitOfMeasureCode: line.unitOfMeasureCode,
      metadata: {
        carbonLineId: line.id ?? "",
        carbonItemId: line.itemId ?? "",
        carbonLineType: line.invoiceLineType ?? "",
        carbonSalesOrderId: line.salesOrderId ?? "",
        carbonSalesOrderLineId: line.salesOrderLineId ?? ""
      }
    }));
}

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
    const contact = await getCustomerContact(serviceRole, customerContact);
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

  let file: ArrayBuffer;
  let fileName: string;
  let documentFilePath: string;

  const serviceRole = getCarbonServiceRole();

  const validation = await validator(salesInvoicePostValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return {
      success: false,
      message: "Invalid notification type"
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

  const setPendingState = await client
    .from("salesInvoice")
    .update({
      status: "Pending"
    })
    .eq("id", invoiceId);

  if (setPendingState.error) {
    return {
      success: false,
      message: "Failed to update sales invoice status"
    };
  }

  try {
    const postSalesInvoice = await serviceRole.functions.invoke(
      "post-sales-invoice",
      {
        body: {
          invoiceId: invoiceId,
          userId: userId,
          companyId: companyId
        }
      }
    );

    if (postSalesInvoice.error) {
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
    const pdf = await pdfLoader({
      ...args,
      params: { ...args.params, id: invoiceId }
    });

    if (pdf.headers.get("content-type") !== "application/pdf") {
      return {
        success: false,
        message: "Failed to generate PDF"
      };
    }

    file = await pdf.arrayBuffer();
    fileName = stripSpecialCharacters(
      `${salesInvoice.data.invoiceId} - ${new Date()
        .toISOString()
        .slice(0, -5)}.pdf`
    );

    documentFilePath = `${companyId}/opportunity/${salesInvoice.data.opportunityId}/${fileName}`;

    const documentFileUpload = await serviceRole.storage
      .from("private")
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

        const [
          company,
          customer,
          salesInvoice,
          salesInvoiceLines,
          salesInvoiceLocations,
          salesInvoiceShipment,
          seller,
          paymentTerms
        ] = await Promise.all([
          getCompany(serviceRole, companyId),
          getCustomerContact(serviceRole, customerContact),
          getSalesInvoice(serviceRole, invoiceId),
          getSalesInvoiceLines(serviceRole, invoiceId),
          getSalesInvoiceCustomerDetails(serviceRole, invoiceId),
          getSalesInvoiceShipment(serviceRole, invoiceId),
          getUser(serviceRole, userId),
          getPaymentTermsList(serviceRole, companyId)
        ]);

        if (!customer?.data?.contact) {
          return {
            success: false,
            message: "Failed to get customer contact"
          };
        }
        if (!company.data) {
          return {
            success: false,
            message: "Failed to get company"
          };
        }
        if (!seller.data) {
          return {
            success: false,
            message: "Failed to get user"
          };
        }
        if (!salesInvoice.data) {
          return {
            success: false,
            message: "Failed to get sales invoice"
          };
        }
        if (!salesInvoiceLocations.data) {
          return {
            success: false,
            message: "Failed to get sales invoice locations"
          };
        }
        if (!salesInvoiceShipment.data) {
          return {
            success: false,
            message: "Failed to get sales invoice shipment"
          };
        }
        if (!paymentTerms.data) {
          return {
            success: false,
            message: "Failed to get payment terms"
          };
        }

        // Same decimals the PDF of this invoice uses.
        const currencyRow = salesInvoice.data.currencyCode
          ? await getCurrencyByCode(
              serviceRole,
              companyGroupId,
              salesInvoice.data.currencyCode
            )
          : null;

        const emailTemplate = SalesInvoiceEmail({
          // @ts-expect-error TS2739 - TODO: fix type
          company: company.data,
          currencyDecimals: currencyRow?.data?.decimalPlaces ?? null,
          locale: locales?.[0] ?? "en-US",
          salesInvoice: salesInvoice.data,
          salesInvoiceLines: salesInvoiceLines.data ?? [],
          salesInvoiceLocations: salesInvoiceLocations.data,
          salesInvoiceShipment: salesInvoiceShipment.data,
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
          },
          paymentTerms: paymentTerms.data
        });

        const html = await renderAsync(emailTemplate);
        const text = await renderAsync(emailTemplate, { plainText: true });
        const { data: signedUrlData } = await serviceRole.storage
          .from("private")
          .createSignedUrl(documentFilePath, 3600);

        await trigger("send-email", {
          to: [seller.data.email, customer.data.contact.email!],
          cc: ccSelections?.length ? ccSelections : undefined,
          from: seller.data.email,
          subject: `Invoice ${salesInvoice.data.invoiceId} from ${company.data.name}`,
          html,
          text,
          attachments: signedUrlData?.signedUrl
            ? [
                {
                  path: signedUrlData.signedUrl,
                  filename: fileName
                }
              ]
            : undefined,
          companyId
        });
        // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
      } catch (err) {
        return {
          success: false,
          message: "Failed to send email"
        };
      }
      break;
    case "Stripe": {
      let stripeInvoice: Awaited<
        ReturnType<typeof createAndSendConnectInvoice>
      >;
      try {
        if (!stripeSendContext) {
          return {
            success: false,
            message: "Invoice posted, but the Stripe send was not prepared"
          };
        }

        // Resolved, confirmed by the user, and linked in the preflight — by
        // here the customer is known to exist on the connected account.
        const { stripeAccountId, stripeCustomerId, customerName } =
          stripeSendContext;

        const [invoiceLines, shipment, addresses, timeZone] = await Promise.all(
          [
            getSalesInvoiceLines(serviceRole, invoiceId),
            getSalesInvoiceShipment(serviceRole, invoiceId),
            getSalesInvoiceCustomerDetails(serviceRole, invoiceId),
            getCompanyTimeZone(serviceRole, companyId)
          ]
        );

        const shippingAddress = addresses.data?.shipmentAddressLine1
          ? {
              name:
                addresses.data.shipmentCustomerName ??
                addresses.data.customerName ??
                customerName,
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

        stripeInvoice = await createAndSendConnectInvoice(
          stripeAccountId,
          stripeCustomerId,
          {
            lines: toStripeInvoiceLines(invoiceLines.data ?? []),
            currencyCode: salesInvoice.data.currencyCode ?? "USD",
            // Invoice-level freight, which the salesInvoices view adds after
            // tax — it is not one of the taxable per-line components.
            shippingCost: shipment.data?.shippingCost ?? 0,
            invoiceNumber: salesInvoice.data.invoiceId ?? undefined,
            // stripeDueDate is the user-chosen override from the post modal,
            // submitted only when the invoice's own dateDue wouldn't survive
            // clampDueDate (missing, past, or too far out). Re-clamped here
            // regardless of source — never trust client input for what
            // reaches a merchant's live Stripe account.
            dueDate: clampDueDate(
              toStripeEpochSeconds(
                stripeDueDate || salesInvoice.data.dateDue,
                timeZone
              )
            ),
            effectiveAt: clampEffectiveAt(
              toStripeEpochSeconds(
                salesInvoice.data.dateIssued ?? salesInvoice.data.postingDate,
                timeZone
              )
            ),
            customFields: salesInvoice.data.customerReference
              ? [
                  {
                    name: "Reference",
                    value: salesInvoice.data.customerReference
                  }
                ]
              : undefined,
            shippingDetails: shippingAddress,
            metadata: {
              carbonInvoiceId: invoiceId,
              carbonInvoiceNumber: salesInvoice.data.invoiceId ?? "",
              companyId,
              carbonOpportunityId: salesInvoice.data.opportunityId ?? "",
              carbonShipmentId: salesInvoice.data.shipmentId ?? ""
            }
          }
        );

        const mappingService = createMappingService(
          getDatabaseClient(),
          companyId
        );

        await mappingService.link(
          "salesInvoice",
          invoiceId,
          STRIPE_CONNECT_INTEGRATION,
          stripeInvoice.id,
          {
            metadata: {
              hostedInvoiceUrl: stripeInvoice.hostedInvoiceUrl,
              invoicePdf: stripeInvoice.invoicePdf
            }
          }
        );
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
            readableInvoiceId: salesInvoice.data.invoiceId,
            opportunityId: salesInvoice.data.opportunityId,
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
