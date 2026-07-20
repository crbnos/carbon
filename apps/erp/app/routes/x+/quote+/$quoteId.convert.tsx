import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  convertQuoteToOrder,
  getSalesOrder,
  salesConfirmValidator,
  selectedLinesValidator
} from "~/modules/sales";
import {
  generateAndAttachSalesOrderPdf,
  sendSalesOrderEmail
} from "~/modules/shared/shared.server";
import { loader as pdfLoader } from "~/routes/file+/sales-order+/$id[.]pdf";
import { path } from "~/utils/path";

const logger = getLogger("erp", "quoteid-convert");

// the edge function grows larger than 2MB - so this is a workaround to avoid the edge function limit

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const formData = await request.formData();
  const selectedLinesRaw = formData.get("selectedLines") ?? "{}";
  const poNumber = (formData.get("poNumber") ?? "") as string;

  if (typeof selectedLinesRaw !== "string") {
    throw redirect(
      path.to.quoteDetails(quoteId),
      await flash(request, error("Invalid selected lines data"))
    );
  }

  const parseResult = selectedLinesValidator.safeParse(
    JSON.parse(selectedLinesRaw)
  );

  if (!parseResult.success) {
    logger.error("Validation error", { error: parseResult.error });
    throw redirect(
      path.to.quoteDetails(quoteId),
      await flash(request, error("Invalid selected lines data"))
    );
  }

  const selectedLines = parseResult.data;

  // Parse notification preferences from form data
  const notificationValidation = await validator(
    salesConfirmValidator
  ).validate(formData);

  const notification = notificationValidation.data?.notification;
  const customerContact = notificationValidation.data?.customerContact;
  const cc = notificationValidation.data?.cc;

  const serviceRole = getCarbonServiceRole();
  const convert = await convertQuoteToOrder(serviceRole, {
    id: quoteId,
    purchaseOrderNumber: poNumber ?? "",
    companyId,
    userId,
    selectedLines
  });

  if (convert.error) {
    throw redirect(
      path.to.quoteDetails(quoteId),
      await flash(
        request,
        error(convert.error, "Failed to convert quote to order")
      )
    );
  }

  const salesOrderId = convert.data?.convertedId!;

  // Generate PDF and optionally send email — failures here should not block
  // the redirect to the new sales order.
  try {
    const salesOrder = await getSalesOrder(serviceRole, salesOrderId);
    if (salesOrder.data?.salesOrderId && salesOrder.data?.opportunityId) {
      const { fileName, documentFilePath } =
        await generateAndAttachSalesOrderPdf({
          routeArgs: args,
          salesOrderId,
          salesOrderIdentifier: salesOrder.data.salesOrderId,
          opportunityId: salesOrder.data.opportunityId,
          companyId,
          userId,
          serviceRole,
          pdfLoader
        });

      if (notification === "Email" && customerContact) {
        const acceptLanguage = request.headers.get("accept-language");
        const locales = parseAcceptLanguage(acceptLanguage, {
          validate: Intl.DateTimeFormat.supportedLocalesOf
        });

        await sendSalesOrderEmail({
          salesOrderId,
          companyId,
          userId,
          customerContactId: customerContact,
          cc,
          documentFilePath,
          fileName,
          serviceRole,
          locales
        });
      }
    }
  } catch (err) {
    logger.error("Failed to generate PDF or send email after conversion", {
      error: err
    });
  }

  throw redirect(
    path.to.salesOrder(salesOrderId),
    await flash(request, success("Successfully converted quote to order"))
  );
}
