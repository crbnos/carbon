import { assertIsPost, notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  dedupeViolations,
  evaluateItemRulesForSalesDocument
} from "@carbon/ee/rules.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
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

const logger = getLogger("erp", "sales", "digital-quote");

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { id } = params;
  if (!id) throw notFound("id not found");

  const formData = await request.formData();
  const type = String(formData.get("type"));

  const serviceRole = getCarbonServiceRole();
  const quote = await getQuoteByExternalId(serviceRole, id);

  if (quote.error) {
    logger.error("Quote not found", { error: quote.error });
    return {
      success: false,
      message: "Quote not found"
    };
  }

  const companySettings = await getCompanySettings(
    serviceRole,
    quote.data.companyId
  );

  // A quote can only be accepted or rejected while it is awaiting a response.
  // Without this guard the unauthenticated share link can be replayed to create
  // duplicate sales orders, or to act on an already ordered / rejected / expired
  // quote (e.g. flipping an ordered quote back to "Lost").
  if (
    (type === "accept" || type === "reject") &&
    quote.data.status !== "Sent"
  ) {
    return {
      success: false,
      message: "This quote is no longer available for a response."
    };
  }

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
        logger.error("Validation error:", { error: parseResult.error });
        return { success: false, message: "Invalid selected lines data" };
      }

      const selectedLines = parseResult.data;

      // Extract purchase order number from PDF filename if available
      let purchaseOrderNumber = "";
      if (file instanceof File && file.name.toLowerCase().endsWith(".pdf")) {
        purchaseOrderNumber = file.name.replace(/\.pdf$/i, "");
      }

      // Terminal gate on the customer-facing accept. This endpoint is
      // unauthenticated — the share link is the only credential — so it is
      // HARD-BLOCK-ONLY: there is no employee here, nobody who may legitimately
      // acknowledge a warning, and internal compliance text must never reach
      // the customer. Errors refuse with a neutral message; warnings are logged
      // for the seller and the order proceeds.
      const { violations: itemRuleViolations } =
        await evaluateItemRulesForSalesDocument({
          client: serviceRole,
          companyId: quote.data.companyId,
          userId: quote.data.createdBy,
          documentType: "quote",
          documentId: quote.data.id
        });
      const dedupedItemRuleViolations = dedupeViolations(itemRuleViolations);
      const blockingViolations = dedupedItemRuleViolations.filter(
        (v) => v.severity === "error"
      );

      if (blockingViolations.length > 0) {
        logger.error("Digital quote acceptance blocked by item rules", {
          quoteId: quote.data.id,
          companyId: quote.data.companyId,
          violations: blockingViolations
        });
        return {
          success: false,
          message:
            "This quote can no longer be accepted online. Please contact your sales representative."
        };
      }

      if (dedupedItemRuleViolations.length > 0) {
        logger.warn("Digital quote accepted with item rule warnings", {
          quoteId: quote.data.id,
          companyId: quote.data.companyId,
          violations: dedupedItemRuleViolations
        });
      }

      const [convert] = await Promise.all([
        convertQuoteToOrder(serviceRole, {
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
        logger.error("Failed to convert quote to order", {
          error: convert.error
        });
        return {
          success: false,
          message: "Failed to convert quote to order"
        };
      }

      // Generate and attach the sales order PDF — non-blocking on failure
      const salesOrderId = convert.data?.convertedId;
      if (salesOrderId) {
        try {
          const salesOrder = await getSalesOrder(serviceRole, salesOrderId);
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
          logger.error(
            "Failed to generate PDF after digital quote acceptance",
            {
              error: err
            }
          );
        }
      }

      if (companySettings.error) {
        logger.error("Failed to get company settings", {
          error: companySettings.error
        });
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
          logger.error("Failed to trigger notification", { error: err });
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
          logger.error("Failed to upload file", { error: fileUpload.error });
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
          logger.error("Failed to update opportunity", {
            error: updateOpportunity.error
          });
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
        logger.error("Failed to reject quote", { error: rejectQuote.error });
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
          logger.error("Failed to trigger notification", { error: err });
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
