import { assertIsPost, notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import {
  convertQuoteToOrder,
  getQuoteByExternalId,
  getSalesOrder,
  selectedLinesValidator
} from "~/modules/sales";
import { getCompanySettings } from "~/modules/settings";
import { generateAndAttachSalesOrderPdf } from "~/modules/shared/shared.server";
import { loader as pdfLoader } from "~/routes/file+/sales-order+/$id[.]pdf";
import { AuthClientScope } from "~/services/mcp";

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { id } = params;
  if (!id) throw notFound("id not found");

  const formData = await request.formData();
  const type = String(formData.get("type"));

  // Public digital-quote acceptance route: no session/middleware identity.
  // Establish the service-role client scope explicitly so service-layer fns
  // (getQuoteByExternalId/getCompanySettings/getSalesOrder/convertQuoteToOrder)
  // resolve a client via getAuthClient(). Replaces main's serviceRole
  // threading. Identity (company/user) is the quote's, passed explicitly.
  const serviceRole = getCarbonServiceRole();
  AuthClientScope.setFactory(() => serviceRole);
  const quote = await getQuoteByExternalId(id);

  if (quote.error) {
    console.error("Quote not found", quote.error);
    return {
      success: false,
      message: "Quote not found"
    };
  }

  const companySettings = await getCompanySettings(quote.data.companyId);

  switch (type) {
    case "accept":
      const digitalQuoteAcceptedBy = String(
        formData.get("digitalQuoteAcceptedBy")
      );
      const digitalQuoteAcceptedByEmail = String(
        formData.get("digitalQuoteAcceptedByEmail")
      );
      const selectedLinesRaw = formData.get("selectedLines") ?? "{}";
      const file = formData.get("file");

      if (typeof selectedLinesRaw !== "string") {
        return { success: false, message: "Invalid selected lines data" };
      }

      const parseResult = selectedLinesValidator.safeParse(
        JSON.parse(selectedLinesRaw)
      );

      if (!parseResult.success) {
        console.error("Validation error:", parseResult.error);
        return { success: false, message: "Invalid selected lines data" };
      }

      const selectedLines = parseResult.data;

      // Extract purchase order number from PDF filename if available
      let purchaseOrderNumber = "";
      if (file instanceof File && file.name.toLowerCase().endsWith(".pdf")) {
        purchaseOrderNumber = file.name.replace(/\.pdf$/i, "");
      }

      const [convert] = await Promise.all([
        convertQuoteToOrder({
          id: quote.data.id,
          companyId: quote.data.companyId,
          userId: quote.data.createdBy,
          selectedLines,
          digitalQuoteAcceptedBy,
          digitalQuoteAcceptedByEmail,
          purchaseOrderNumber
        })
      ]);

      if (convert.error) {
        console.error("Failed to convert quote to order", convert.error);
        return {
          success: false,
          message: "Failed to convert quote to order"
        };
      }

      // Generate and attach the sales order PDF — non-blocking on failure
      const salesOrderId = convert.data?.convertedId;
      if (salesOrderId) {
        try {
          const salesOrder = await getSalesOrder(salesOrderId);
          if (salesOrder.data?.salesOrderId && salesOrder.data?.opportunityId) {
            await generateAndAttachSalesOrderPdf({
              routeArgs: args,
              salesOrderId,
              salesOrderIdentifier: salesOrder.data.salesOrderId,
              opportunityId: salesOrder.data.opportunityId,
              companyId: quote.data.companyId,
              userId: quote.data.createdBy,
              serviceRole,
              pdfLoader
            });
          }
        } catch (err) {
          console.error(
            "Failed to generate PDF after digital quote acceptance",
            err
          );
        }
      }

      if (companySettings.error) {
        console.error("Failed to get company settings", companySettings.error);
        return {
          success: false,
          message: "Failed to send notification"
        };
      }

      if (companySettings.data?.digitalQuoteNotificationGroup?.length) {
        try {
          await trigger("notify", {
            companyId: companySettings.data.id,
            documentId: quote.data.id,
            event: NotificationEvent.DigitalQuoteResponse,
            recipient: {
              type: "group",
              groupIds:
                companySettings.data?.digitalQuoteNotificationGroup ?? []
            }
          });
        } catch (err) {
          console.error("Failed to trigger notification", err);
          return {
            success: false,
            message: "Failed to send notification"
          };
        }
      }

      if (file && file instanceof File) {
        const purchaseOrderDocumentPath = `${companySettings.data.id}/opportunity/${quote.data.opportunityId}/${file.name}`;

        const fileUpload = await serviceRole.storage
          .from("private")
          .upload(purchaseOrderDocumentPath, file);

        if (fileUpload.error) {
          console.error("Failed to upload file", fileUpload.error);
          return {
            success: false,
            message: "Failed to upload file"
          };
        }

        const updateOpportunity = await serviceRole
          .from("opportunity")
          .update({
            purchaseOrderDocumentPath
          })
          .eq("id", quote.data.opportunityId!);

        if (updateOpportunity.error) {
          console.error(
            "Failed to update opportunity",
            updateOpportunity.error
          );
        }
      }

      return {
        success: true,
        message: "Quote accepted!"
      };

    case "reject":
      const digitalQuoteRejectedBy = String(
        formData.get("digitalQuoteRejectedBy")
      );
      const digitalQuoteRejectedByEmail = String(
        formData.get("digitalQuoteRejectedByEmail")
      );

      const rejectQuote = await serviceRole
        .from("quote")
        .update({
          status: "Lost",
          digitalQuoteRejectedBy,
          digitalQuoteRejectedByEmail
        })
        .eq("id", quote.data.id);

      if (rejectQuote.error) {
        console.error("Failed to reject quote", rejectQuote.error);
        return {
          success: false,
          message: "Failed to reject quote"
        };
      }

      if (companySettings.data?.digitalQuoteNotificationGroup?.length) {
        try {
          await trigger("notify", {
            companyId: companySettings.data.id,
            documentId: quote.data.id,
            event: NotificationEvent.DigitalQuoteResponse,
            recipient: {
              type: "group",
              groupIds:
                companySettings.data?.digitalQuoteNotificationGroup ?? []
            }
          });
        } catch (err) {
          console.error("Failed to trigger notification", err);
          return {
            success: false,
            message: "Failed to send notification"
          };
        }
      }

      return {
        success: true,
        message: "Quote rejected!"
      };

    default:
      return { success: false, message: "Invalid type" };
  }
}
