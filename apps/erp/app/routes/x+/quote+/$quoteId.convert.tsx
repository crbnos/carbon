// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { getErrorMessage, redirect } from "@carbon/utils";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import type { ActionFunctionArgs } from "react-router";
import {
  convertQuoteToOrder,
  getSalesOrder,
  salesConfirmValidator,
  selectedLinesValidator
} from "~/modules/sales";
import { recordSalesRuleOutcome } from "~/modules/sales/sales.server";
import {
  generateAndAttachSalesOrderPdf,
  requireCompanyRecord,
  sendSalesOrderEmail
} from "~/modules/shared/shared.server";
import { loader as pdfLoader } from "~/routes/file+/sales-order+/$id[.]pdf";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "quoteid-convert");

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

  // Everything below runs with the service role and keys on the URL quote.
  const serviceRole = getCarbonServiceRole();
  await requireCompanyRecord(serviceRole, "quote", companyId, { id: quoteId });

  // Terminal gate, in the route rather than inside the `convert` server function:
  // the server function writes salesOrderLine rows directly and cannot run the
  // evaluator (the evaluator's plan gate pulls in the ERP server runtime).
  // Gating here covers this path without duplicating the evaluator.
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

  const convert = await convertQuoteToOrder(serviceRole, getDatabaseClient(), {
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
          getErrorMessage(convert.error, "Failed to convert quote to order")
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
