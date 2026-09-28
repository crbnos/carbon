import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  dedupeViolations,
  evaluateSalesRulesForSalesDocument,
  isBlocked
} from "@carbon/ee/rules.server";
import { validator } from "@carbon/form";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import type { ActionFunctionArgs } from "react-router";
import { getSalesOrder, salesConfirmValidator } from "~/modules/sales";
import {
  confirmSalesOrder,
  recordSalesRuleOutcome
} from "~/modules/sales/sales.server";
import {
  generateAndAttachSalesOrderPdf,
  sendSalesOrderEmail
} from "~/modules/shared/shared.server";
import { loader as pdfLoader } from "~/routes/file+/sales-order+/$id[.]pdf";

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;

  try {
    assertIsPost(request);

    const { client, companyId, companyGroupId, userId } =
      await requirePermissions(request, {
        create: "sales",
        role: "employee"
      });

    const { orderId } = params;
    if (!orderId) {
      return {
        success: false,
        message: "Could not find orderId"
      };
    }

    const serviceRole = getCarbonServiceRole();

    const salesOrder = await getSalesOrder(serviceRole, orderId);
    if (salesOrder.error) {
      return {
        success: false,
        message: "Failed to get sales order"
      };
    }

    if (salesOrder.data.companyId !== companyId) {
      return {
        success: false,
        message: "You are not authorized to confirm this sales order"
      };
    }

    // Terminal gate: re-evaluate sales rules across EVERY line on the order,
    // with today's context. Per-line checks only cover lines added through the
    // line routes — conversions, duplication, integrations and the API all
    // write lines without them — and a line that passed weeks ago may violate
    // a rule authored since, or a ship-to that has changed. Runs before the PDF
    // so a blocked order doesn't generate one.
    const formData = await request.formData();
    const acknowledged = formData.get("acknowledged") === "true";

    const { violations, ruleNames } = await evaluateSalesRulesForSalesDocument({
      client: serviceRole,
      companyId,
      userId,
      documentType: "salesOrder",
      documentId: orderId
    });
    const deduped = dedupeViolations(violations);
    if (deduped.length > 0 && isBlocked(deduped, acknowledged)) {
      // Record the same evidence + notification the per-line checks write —
      // an override at a gate is the strongest kind and must leave a trail.
      await recordSalesRuleOutcome(serviceRole, {
        companyId,
        userId,
        documentType: "salesOrder",
        documentId: orderId,
        outcome: "blocked",
        violations: deduped,
        ruleNames
      });
      return {
        success: false,
        message: "Sales rule violations must be resolved before confirming",
        violations: deduped,
        ruleNames
      };
    }

    const acceptLanguage = request.headers.get("accept-language");
    const locales = parseAcceptLanguage(acceptLanguage, {
      validate: Intl.DateTimeFormat.supportedLocalesOf
    });

    let fileName: string;
    let documentFilePath: string;

    try {
      const result = await generateAndAttachSalesOrderPdf({
        routeArgs: args,
        salesOrderId: orderId,
        salesOrderIdentifier: salesOrder.data.salesOrderId!,
        opportunityId: salesOrder.data.opportunityId!,
        companyId,
        userId,
        serviceRole,
        pdfLoader
      });
      fileName = result.fileName;
      documentFilePath = result.documentFilePath;
      // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    } catch (err) {
      return {
        success: false,
        message: "Failed to generate PDF"
      };
    }

    const validation = await validator(salesConfirmValidator).validate(
      formData
    );

    if (validation.error) {
      return {
        success: false,
        message: "Invalid form data"
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

          const emailResult = await sendSalesOrderEmail({
            salesOrderId: orderId,
            companyId,
            companyGroupId,
            userId,
            customerContactId: customerContact,
            cc: ccSelections,
            documentFilePath,
            fileName,
            serviceRole,
            locales
          });

          if (!emailResult.success) {
            return {
              success: false,
              message: emailResult.message ?? "Failed to send email"
            };
          }
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

    // Status from the lines, order date, MRP — one command, the same one
    // `sales_releaseSalesOrder` runs over MCP. The write uses the caller's
    // client, so RLS still applies to it.
    const confirm = await confirmSalesOrder(client, {
      salesOrderId: orderId,
      companyId,
      userId,
      emailed: notification === "Email"
    });

    if (confirm.error) {
      return {
        success: false,
        message: "Failed to confirm sales order"
      };
    }

    // Acknowledged-override evidence is written only once the confirm has
    // actually committed — evidence (and its notification) for a transition
    // that then failed would be a false trail, and a retry would duplicate it.
    if (deduped.length > 0) {
      await recordSalesRuleOutcome(serviceRole, {
        companyId,
        userId,
        documentType: "salesOrder",
        documentId: orderId,
        outcome: "acknowledged",
        violations: deduped,
        ruleNames
      });
    }

    return {
      success: true,
      message: "Sales order confirmed"
    };
  } catch (err) {
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "An unexpected error occurred"
    };
  }
}
