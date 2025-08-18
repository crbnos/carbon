import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { SalesOrderEmail } from "@carbon/documents/email";
import { validator } from "@carbon/form";
import type { sendEmailResendTask } from "@carbon/jobs/trigger/send-email-resend";
import { getLocalTimeZone, today } from "@internationalized/date";
import { renderAsync } from "@react-email/components";
import { tasks } from "@trigger.dev/sdk/v3";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import { getPaymentTermsList } from "~/modules/accounting";
import { upsertDocument } from "~/modules/documents";
import { runMRP } from "~/modules/production/production.service";
import {
  getCustomerContact,
  getSalesOrder,
  getSalesOrderCustomerDetails,
  getSalesOrderLines,
  salesConfirmValidator,
} from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import { getUser } from "~/modules/users/users.server";
import { loader as pdfLoader } from "~/routes/file+/sales-order+/$id[.]pdf";
import { stripSpecialCharacters } from "~/utils/string";

export const config = { runtime: "nodejs" };

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;

  try {
    assertIsPost(request);

    const { client, companyId, userId } = await requirePermissions(request, {
      create: "sales",
      role: "employee",
    });

    const { orderId } = params;
    if (!orderId) {
      return json({
        success: false,
        message: "Could not find orderId",
      });
    }

    let file: ArrayBuffer;
    let fileName: string;

    const serviceRole = getCarbonServiceRole();

    const [salesOrder] = await Promise.all([
      getSalesOrder(serviceRole, orderId),
    ]);
    if (salesOrder.error) {
      return json({
        success: false,
        message: "Failed to get sales order",
      });
    }

    if (salesOrder.data.companyId !== companyId) {
      return json({
        success: false,
        message: "You are not authorized to confirm this sales order",
      });
    }

    const acceptLanguage = request.headers.get("accept-language");
    const locales = parseAcceptLanguage(acceptLanguage, {
      validate: Intl.DateTimeFormat.supportedLocalesOf,
    });

    try {
      // Pass orderId as id for PDF generation
      const pdfArgs = {
        ...args,
        params: { ...args.params, id: orderId },
      };
      const pdf = await pdfLoader(pdfArgs);

      if (pdf.headers.get("content-type") !== "application/pdf") {
        return json({
          success: false,
          message: "Failed to generate PDF",
        });
      }

      file = await pdf.arrayBuffer();
      fileName = stripSpecialCharacters(
        `${salesOrder.data.salesOrderId} - ${new Date()
          .toISOString()
          .slice(0, -5)}.pdf`
      );

      const documentFilePath = `${companyId}/opportunity/${salesOrder.data.opportunityId}/${fileName}`;

      const documentFileUpload = await serviceRole.storage
        .from("private")
        .upload(documentFilePath, file, {
          cacheControl: `${12 * 60 * 60}`,
          contentType: "application/pdf",
          upsert: true,
        });

      if (documentFileUpload.error) {
        return json({
          success: false,
          message: "Failed to upload file",
        });
      }

      const createDocument = await upsertDocument(serviceRole, {
        path: documentFilePath,
        name: fileName,
        size: Math.round(file.byteLength / 1024),
        sourceDocument: "Sales Order",
        sourceDocumentId: orderId,
        readGroups: [userId],
        writeGroups: [userId],
        createdBy: userId,
        companyId,
      });

      if (createDocument.error) {
        return json({
          success: false,
          message: "Failed to create document",
        });
      }
    } catch (err) {
      return json({
        success: false,
        message: "Failed to generate PDF",
      });
    }

    const validation = await validator(salesConfirmValidator).validate(
      await request.formData()
    );

    if (validation.error) {
      return json({
        success: false,
        message: "Invalid form data",
      });
    }

    const { notification, customerContact } = validation.data;

    switch (notification) {
      case "Email":
        try {
          if (!customerContact) {
            return json({
              success: false,
              message: "Customer contact is required",
            });
          }

          const [
            company,
            customer,
            salesOrder,
            salesOrderLines,
            salesOrderLocations,
            seller,
            paymentTerms,
          ] = await Promise.all([
            getCompany(serviceRole, companyId),
            getCustomerContact(serviceRole, customerContact),
            getSalesOrder(serviceRole, orderId),
            getSalesOrderLines(serviceRole, orderId),
            getSalesOrderCustomerDetails(serviceRole, orderId),
            getUser(serviceRole, userId),
            getPaymentTermsList(serviceRole, companyId),
          ]);

          if (!customer?.data?.contact) {
            return json({
              success: false,
              message: "Failed to get customer contact",
            });
          }
          if (!company.data) {
            return json({
              success: false,
              message: "Failed to get company",
            });
          }
          if (!seller.data) {
            return json({
              success: false,
              message: "Failed to get user",
            });
          }
          if (!salesOrder.data) {
            return json({
              success: false,
              message: "Failed to get sales order",
            });
          }
          if (!salesOrderLocations.data) {
            return json({
              success: false,
              message: "Failed to get sales order locations",
            });
          }

          if (!paymentTerms.data) {
            return json({
              success: false,
              message: "Failed to get payment terms",
            });
          }

          const emailTemplate = SalesOrderEmail({
            company: company.data,
            locale: locales?.[0] ?? "en-US",
            salesOrder: salesOrder.data,
            salesOrderLines: salesOrderLines.data ?? [],
            salesOrderLocations: salesOrderLocations.data,
            recipient: {
              email: customer.data.contact.email,
              firstName: customer.data.contact.firstName ?? undefined,
              lastName: customer.data.contact.lastName ?? undefined,
            },
            sender: {
              email: seller.data.email,
              firstName: seller.data.firstName,
              lastName: seller.data.lastName,
            },
            paymentTerms: paymentTerms.data,
          });

          const html = await renderAsync(emailTemplate);
          const text = await renderAsync(emailTemplate, { plainText: true });

          await tasks.trigger<typeof sendEmailResendTask>("send-email-resend", {
            to: [seller.data.email, customer.data.contact.email],
            from: seller.data.email,
            subject: `Order ${salesOrder.data.salesOrderId} from ${company.data.name}`,
            html,
            text,
            attachments: [
              {
                content: Buffer.from(file).toString("base64"),
                filename: fileName,
              },
            ],
            companyId,
          });
        } catch (err) {
          return json({
            success: false,
            message: "Failed to send email",
          });
        }
        break;
      case undefined:
      case "None":
        break;
      default:
        return json({
          success: false,
          message: "Invalid notification type",
        });
    }

    const confirm = await client
      .from("salesOrder")
      .update({
        status: "To Ship and Invoice",
        orderDate:
          salesOrder.data.orderDate ?? today(getLocalTimeZone()).toString(),
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", orderId);

    if (confirm.error) {
      return json({
        success: false,
        message: "Failed to confirm sales order",
      });
    }

    await runMRP(getCarbonServiceRole(), {
      type: "salesOrder",
      id: orderId,
      companyId: companyId,
      userId: userId,
    });

    return json({
      success: true,
      message: "Sales order confirmed",
    });
  } catch (err) {
    return json({
      success: false,
      message:
        err instanceof Error ? err.message : "An unexpected error occurred",
    });
  }
}
