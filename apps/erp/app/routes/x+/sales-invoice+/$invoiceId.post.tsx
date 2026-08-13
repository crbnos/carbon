import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { SalesInvoiceEmail } from "@carbon/documents/email";
import { validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { raiseMoment } from "@carbon/lib/workflows";
import { renderAsync } from "@react-email/components";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import type { ActionFunctionArgs } from "react-router";
import { getCurrencyByCode, getPaymentTermsList } from "~/modules/accounting";
import { upsertDocument } from "~/modules/documents";
import {
  getSalesInvoice,
  getSalesInvoiceCustomerDetails,
  getSalesInvoiceLines,
  getSalesInvoiceShipment
} from "~/modules/invoicing";
import { getCustomerContact, salesConfirmValidator } from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import { getUser } from "~/modules/users/users.server";
import { loader as pdfLoader } from "~/routes/file+/sales-invoice+/$id[.]pdf";
import { stripSpecialCharacters } from "~/utils/string";

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

  const serviceRole = getCarbonServiceRole();

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

  const validation = await validator(salesConfirmValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return {
      success: false,
      message: "Invalid notification type"
    };
  }

  const { notification, customerContact, cc: ccSelections } = validation.data;

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
