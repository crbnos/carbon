import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  dedupeViolations,
  evaluateSalesRulesForSalesDocument,
  isBlocked
} from "@carbon/ee/rules.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { Violation } from "@carbon/utils";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  convertQuoteToOrder,
  getSalesOrder,
  salesConfirmValidator,
  selectedLinesValidator
} from "~/modules/sales";
import { recordSalesRuleOutcome } from "~/modules/sales/sales.server";
import {
  generateAndAttachSalesOrderPdf,
  sendSalesOrderEmail
} from "~/modules/shared/shared.server";
import { loader as pdfLoader } from "~/routes/file+/sales-order+/$id[.]pdf";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import { path } from "~/utils/path";

const logger = getLogger("erp", "quoteid-convert");

// the edge function grows larger than 2MB - so this is a workaround to avoid the edge function limit

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);
  const { companyId, companyGroupId, userId } = await requirePermissions(
    request,
    {
      create: "sales"
    }
  );

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

  // Terminal gate, in the route rather than inside the `convert` edge function:
  // the edge function writes salesOrderLine rows directly and cannot run the
  // evaluator (it is Deno, and the evaluator's plan gate pulls in the ERP
  // server runtime). Gating here covers this path without duplicating the
  // evaluator into a tree CI never typechecks or tests.
  const acknowledged = formData.get("acknowledged") === "true";
  let violations: Violation[];
  let ruleNames: Record<string, string>;
  try {
    const result = await evaluateSalesRulesForSalesDocument({
      client: serviceRole,
      companyId,
      userId,
      documentType: "quote",
      documentId: quoteId
    });
    violations = result.violations;
    ruleNames = result.ruleNames;
  } catch (err) {
    // Fail closed but not as a raw 500 — the modal shows the message.
    return {
      violations: [
        {
          ruleId: "__evaluation-error__",
          severity: "error" as const,
          message:
            err instanceof Error ? err.message : "Sales rule evaluation failed"
        }
      ],
      ruleNames: {}
    };
  }
  // Only the SELECTED lines convert (quantity > 0) — a deselected line never
  // becomes a sales-order line, so its violations must not block the
  // conversion or leave "acknowledged" evidence for a line that never
  // converted. A violation without a lineId (shouldn't happen — the document
  // evaluator stamps every one) is kept, failing closed.
  const convertingLineIds = new Set(
    Object.entries(selectedLines)
      .filter(([, line]) => (line.quantity ?? 0) > 0)
      .map(([lineId]) => lineId)
  );
  const deduped = dedupeViolations(violations).filter(
    (v) => !v.lineId || convertingLineIds.has(v.lineId)
  );
  if (deduped.length > 0 && isBlocked(deduped, acknowledged)) {
    // Record the same evidence + notification the per-line checks write —
    // an override at a gate is the strongest kind and must leave a trail.
    await recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "quote",
      documentId: quoteId,
      outcome: "blocked",
      violations: deduped,
      ruleNames
    });
    return { violations: deduped, ruleNames };
  }

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
        error(
          convert.error,
          await getEdgeFunctionErrorMessage(
            convert.error,
            "Failed to convert quote to order"
          )
        )
      )
    );
  }

  const salesOrderId = convert.data?.convertedId!;

  // Acknowledged-override evidence only once the conversion has committed —
  // a trail for a conversion that then failed would be false, and a retry
  // would duplicate it.
  if (deduped.length > 0) {
    await recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "quote",
      documentId: quoteId,
      outcome: "acknowledged",
      violations: deduped,
      ruleNames
    });
  }

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
          companyGroupId,
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
