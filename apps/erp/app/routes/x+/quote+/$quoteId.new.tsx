import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  dedupeViolations,
  evaluateSalesRuleLines,
  isBlocked
} from "@carbon/ee/rules.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { breakQuantities } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getQuote, isQuoteLocked, quoteLineValidator } from "~/modules/sales";
import {
  createQuoteLineWithPrices,
  recordSalesRuleOutcome
} from "~/modules/sales/sales.server";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "quote");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  // The line is inserted with the service role, which bypasses RLS: the quote
  // must belong to this company.
  const serviceRole = getCarbonServiceRole();
  await requireCompanyRecord(serviceRole, "quote", companyId, {
    id: quoteId
  });

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });
  const quote = await getQuote(viewClient, quoteId);
  await requireUnlocked({
    request,
    isLocked: isQuoteLocked(quote.data?.status),
    redirectTo: path.to.quote(quoteId),
    message: "Cannot modify a locked quote. Reopen it first."
  });

  const formData = await request.formData();
  const validation = await validator(quoteLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;
  let configuration = undefined;
  if (d.configuration) {
    try {
      configuration = JSON.parse(d.configuration);
    } catch (error) {
      logger.error("Failed to parse quote line configuration", { error });
    }
  }

  // Sales-rule enforcement: evaluate before the line is written. Blocked
  // submissions return violations for the form's violation modal;
  // acknowledged warns pass through on re-submit.
  const acknowledged = formData.get("acknowledged") === "true";
  const { violations, ruleNames } = await evaluateSalesRuleLines({
    client: serviceRole,
    companyId,
    userId,
    surface: "quoteLine",
    // Quote lines carry a quantity-break array rather than a single
    // transaction quantity. Evaluate every break — a min-quantity rule fires
    // on the smallest, a max-quantity rule on the largest; dedupe collapses
    // same-message repeats.
    lines: breakQuantities(d.quantity).map((quantity) => ({
      lineId: "new",
      itemId: d.itemId ?? null,
      quantity
    })),
    customerId: quote.data?.customerId ?? null,
    customerLocationId: quote.data?.customerLocationId ?? null
  });
  const deduped = dedupeViolations(violations);
  const blocked = deduped.length > 0 && isBlocked(deduped, acknowledged);
  if (blocked) {
    // No line exists on a blocked create, so documentLineId stays null.
    await recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "quote",
      documentId: quoteId,
      documentLineId: null,
      itemId: d.itemId ?? null,
      outcome: "blocked",
      violations: deduped,
      ruleNames
    });
    return { error: null, data: null, violations: deduped, ruleNames };
  }

  // The insert and its pricing (price rows per break, or the make-method pull
  // and reprice) are one command — the same one `sales_upsertQuoteLine` runs
  // for a create over MCP.
  const created = await createQuoteLineWithPrices(serviceRole, {
    companyId,
    quoteId,
    userId,
    line: d,
    configuration,
    customFields: setCustomFields(formData)
  });

  if (!created.data) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(
        request,
        error(created.error ? created.cause : null, created.error?.message)
      )
    );
  }

  const quoteLineId = created.data.id;

  // Acknowledged proceed: persist override evidence now that the line exists
  // so documentLineId captures the created line (and the notification only
  // fires for a line that actually landed).
  if (deduped.length > 0) {
    await recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "quote",
      documentId: quoteId,
      documentLineId: quoteLineId,
      itemId: d.itemId ?? null,
      outcome: "acknowledged",
      violations: deduped,
      ruleNames
    });
  }

  if (created.error) {
    throw redirect(
      path.to.quoteLine(quoteId, quoteLineId),
      await flash(request, error(created.cause, created.error.message))
    );
  }

  throw redirect(path.to.quoteLine(quoteId, quoteLineId));
}
