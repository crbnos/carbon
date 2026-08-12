import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { SalesInvoiceEmail } from "@carbon/documents/email";
import { createMappingService } from "@carbon/ee/accounting";
import { validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import {
  createAndSendConnectInvoice,
  createConnectCustomer
} from "@carbon/stripe/connect.server";
import { datetime } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { renderAsync } from "@react-email/components";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import type { ActionFunctionArgs } from "react-router";
import { getPaymentTermsList } from "~/modules/accounting";
import { upsertDocument } from "~/modules/documents";
import {
  getSalesInvoice,
  getSalesInvoiceCustomerDetails,
  getSalesInvoiceLines,
  getSalesInvoiceShipment,
  salesInvoicePostValidator
} from "~/modules/invoicing";
import { getCustomer, getCustomerContact } from "~/modules/sales";
import { getCompany } from "~/modules/settings";
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

  const response = await fetch(invoicePdf);
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
  hostedInvoiceUrl,
  userId
}: {
  serviceRole: ServiceRole;
  invoiceId: string;
  hostedInvoiceUrl: string | null;
  userId: string;
}) {
  if (!hostedInvoiceUrl) return;

  const existing = await serviceRole
    .from("salesInvoice")
    .select("externalNotes")
    .eq("id", invoiceId)
    .single();

  if (existing.error) {
    throw new Error("Failed to read invoice notes");
  }

  const current = (existing.data?.externalNotes ?? {}) as {
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
    .eq("id", invoiceId);

  if (update.error) {
    throw new Error("Failed to write the Stripe payment link to invoice notes");
  }
}

type StripeSendContext = {
  stripeAccountId: string;
  billingCustomerId: string;
  customerName: string;
  contactEmail: string;
};

async function preflightStripeSend({
  serviceRole,
  companyId,
  invoiceId,
  customerContact
}: {
  serviceRole: ServiceRole;
  companyId: string;
  invoiceId: string;
  customerContact?: string;
}): Promise<
  { ok: true; context: StripeSendContext } | { ok: false; message: string }
> {
  if (!customerContact) {
    return { ok: false, message: "a customer contact is required" };
  }

  const integration = await serviceRole
    .from("companyIntegration")
    .select("active, metadata")
    .eq("id", "stripe-connect")
    .eq("companyId", companyId)
    .maybeSingle();

  const stripeAccountId = (
    integration.data?.metadata as Record<string, unknown> | undefined
  )?.stripeAccountId as string | undefined;

  if (!integration.data?.active || !stripeAccountId) {
    return {
      ok: false,
      message: "Stripe Connect is not connected for this company"
    };
  }

  const invoice = await serviceRole
    .from("salesInvoice")
    .select("customerId, invoiceCustomerId")
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (!invoice.data) {
    return { ok: false, message: "the invoice could not be loaded" };
  }

  const billingCustomerId =
    invoice.data.invoiceCustomerId ?? invoice.data.customerId;

  if (!billingCustomerId) {
    return { ok: false, message: "this invoice has no customer to bill" };
  }

  const [contact, customer, lines] = await Promise.all([
    getCustomerContact(serviceRole, customerContact),
    getCustomer(serviceRole, billingCustomerId),
    getSalesInvoiceLines(serviceRole, invoiceId)
  ]);

  const contactEmail = contact.data?.contact?.email;
  if (!contactEmail) {
    return { ok: false, message: "the selected contact has no email address" };
  }

  const customerName = customer.data?.name;
  if (!customerName) {
    return { ok: false, message: "the customer could not be loaded" };
  }

  const total = (lines.data ?? []).reduce(
    (sum, line) => sum + (line.unitPrice ?? 0) * (line.quantity ?? 0),
    0
  );
  if (total <= 0) {
    return {
      ok: false,
      message: "Stripe cannot send a zero-amount invoice"
    };
  }

  return {
    ok: true,
    context: {
      stripeAccountId,
      billingCustomerId,
      customerName,
      contactEmail
    }
  };
}

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
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

  // Validate before mutating anything — the form body is the only input that
  // can reject the request outright.
  const validation = await validator(salesInvoicePostValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return {
      success: false,
      message: "Invalid notification type"
    };
  }

  const { notification, customerContact, cc: ccSelections } = validation.data;

  let stripeSendContext: StripeSendContext | null = null;
  if (notification === "Stripe") {
    const preflight = await preflightStripeSend({
      serviceRole,
      companyId,
      invoiceId,
      customerContact
    });

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

        const emailTemplate = SalesInvoiceEmail({
          // @ts-expect-error TS2739 - TODO: fix type
          company: company.data,
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
    case "Stripe":
      try {
        if (!stripeSendContext) {
          return {
            success: false,
            message: "Invoice posted, but the Stripe send was not prepared"
          };
        }

        const {
          stripeAccountId,
          billingCustomerId,
          customerName,
          contactEmail
        } = stripeSendContext;

        const invoiceLines = await getSalesInvoiceLines(serviceRole, invoiceId);

        const mappingService = createMappingService(
          getDatabaseClient(),
          companyId
        );

        let stripeCustomerId = (
          await mappingService.getByEntity(
            "customer",
            billingCustomerId,
            "stripe-connect"
          )
        )?.externalId;

        if (!stripeCustomerId) {
          stripeCustomerId = await createConnectCustomer(stripeAccountId, {
            name: customerName,
            email: contactEmail
          });
          await mappingService.link(
            "customer",
            billingCustomerId,
            "stripe-connect",
            stripeCustomerId
          );
        }

        const daysUntilDue =
          salesInvoice.data.dateIssued && salesInvoice.data.dateDue
            ? Math.max(
                1,
                parseDate(salesInvoice.data.dateDue).compare(
                  parseDate(salesInvoice.data.dateIssued)
                )
              )
            : 30;

        const stripeInvoice = await createAndSendConnectInvoice(
          stripeAccountId,
          stripeCustomerId,
          {
            lines: (invoiceLines.data ?? []).map((line) => ({
              description: line.description ?? "",
              quantity: line.quantity ?? 0,
              unitPrice: line.unitPrice ?? 0
            })),
            currencyCode: salesInvoice.data.currencyCode ?? "USD",
            daysUntilDue,
            metadata: { carbonInvoiceId: invoiceId, companyId }
          }
        );

        await mappingService.link(
          "salesInvoice",
          invoiceId,
          "stripe-connect",
          stripeInvoice.id,
          {
            metadata: {
              hostedInvoiceUrl: stripeInvoice.hostedInvoiceUrl,
              invoicePdf: stripeInvoice.invoicePdf
            }
          }
        );

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
            hostedInvoiceUrl: stripeInvoice.hostedInvoiceUrl,
            userId
          })
        ]);
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
