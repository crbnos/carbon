import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { datetime, getSalesOrderStatus } from "@carbon/utils";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import type { ActionFunctionArgs } from "react-router";
import { runMRP } from "~/modules/production/production.service";
import {
  getSalesOrder,
  getSalesOrderLines,
  salesConfirmValidator
} from "~/modules/sales";
import {
  generateAndAttachSalesOrderPdf,
  sendSalesOrderEmail
} from "~/modules/shared/shared.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
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
      await request.formData()
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

    const orderLines = await getSalesOrderLines(serviceRole, orderId);
    const { status } = getSalesOrderStatus(orderLines.data || []);

    const confirm = await client
      .from("salesOrder")
      .update({
        status,
        orderDate:
          salesOrder.data.orderDate ??
          datetime
            .today(await getCompanyTimeZone(client, companyId))
            .toString(),
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .eq("id", orderId);

    if (confirm.error) {
      return {
        success: false,
        message: "Failed to confirm sales order"
      };
    }

    await runMRP(getCarbonServiceRole(), {
      type: "salesOrder",
      id: orderId,
      companyId: companyId,
      userId: userId
    });

    // Below every early return above, so a failed email or a failed status
    // write never counts as a confirmed order.
    trackWorkEvent("sales_order_confirmed", {
      companyId,
      userId,
      salesOrderId: orderId,
      lineCount: orderLines.data?.length ?? 0,
      derivedStatus: status,
      emailed: notification === "Email"
    });

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
