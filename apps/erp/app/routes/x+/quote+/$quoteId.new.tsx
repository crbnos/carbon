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
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getQuote,
  isQuoteLocked,
  quoteLineValidator,
  recalculateQuoteLinePrices,
  resolvePurchaseToOrderPrices,
  resolveQuoteLinePrices,
  upsertQuoteLine,
  upsertQuoteLineMethod
} from "~/modules/sales";
import { getCompanySettings } from "~/modules/settings";
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

  const serviceRole = getCarbonServiceRole();

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
    // transaction quantity. Evaluate the largest break — it is the one most
    // likely to trip a `gt` threshold, so it is the conservative choice.
    lines: [
      {
        lineId: "new",
        itemId: d.itemId ?? null,
        quantity: Math.max(1, ...(d.quantity ?? [1]))
      }
    ],
    customerId: quote.data?.customerId ?? null,
    customerLocationId: quote.data?.customerLocationId ?? null
  });
  const deduped = dedupeViolations(violations);
  const blocked = deduped.length > 0 && isBlocked(deduped, acknowledged);
  if (deduped.length > 0) {
    const outcome = blocked ? ("blocked" as const) : ("acknowledged" as const);

    if (blocked) {
      // Persist blocked evidence — one row per deduped violation. No line
      // exists on a blocked create, so documentLineId stays null. Failures
      // must never break the submission.
      const acknowledgmentInsert = await serviceRole
        .from("salesRuleAcknowledgment")
        .insert(
          deduped.map((v) => ({
            companyId,
            ruleId: v.ruleId,
            ruleName: ruleNames[v.ruleId] ?? null,
            documentType: "quote" as const,
            documentId: quoteId,
            documentLineId: null,
            itemId: d.itemId ?? null,
            severity: v.severity,
            outcome,
            message: v.message,
            createdBy: userId
          }))
        );
      if (acknowledgmentInsert.error) {
        logger.error("Failed to record sales rule acknowledgments", {
          error: acknowledgmentInsert.error
        });
      }
    }

    // Notify the configured group — fire-and-forget; a notification failure
    // must never break the submission.
    try {
      const companySettings = await getCompanySettings(serviceRole, companyId);
      if (companySettings.data?.salesRuleNotificationGroup?.length) {
        await trigger("notify", {
          companyId,
          documentId: `quote:${quoteId}:${outcome}`,
          event: NotificationEvent.SalesRuleViolation,
          recipient: {
            type: "group",
            groupIds: companySettings.data.salesRuleNotificationGroup
          },
          from: userId
        });
      }
    } catch (err) {
      logger.error("Failed to trigger sales rule violation notification", {
        error: err
      });
    }

    if (blocked) {
      return { error: null, data: null, violations: deduped, ruleNames };
    }
  }

  const createQuotationLine = await upsertQuoteLine(serviceRole, {
    ...d,
    companyId,
    configuration,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createQuotationLine.error) {
    logger.error("Failed to create quote line", {
      error: createQuotationLine.error
    });
    throw redirect(
      path.to.quote(quoteId),
      await flash(
        request,
        error(createQuotationLine.error, "Failed to create quote line.")
      )
    );
  }

  const quoteLineId = createQuotationLine.data.id;

  // Acknowledged proceed: persist override evidence now that the line exists
  // so documentLineId captures the created line. Failures must never break
  // the submission.
  if (deduped.length > 0 && !blocked) {
    const acknowledgmentInsert = await serviceRole
      .from("salesRuleAcknowledgment")
      .insert(
        deduped.map((v) => ({
          companyId,
          ruleId: v.ruleId,
          ruleName: ruleNames[v.ruleId] ?? null,
          documentType: "quote" as const,
          documentId: quoteId,
          documentLineId: quoteLineId,
          itemId: d.itemId ?? null,
          severity: v.severity,
          outcome: "acknowledged" as const,
          message: v.message,
          createdBy: userId
        }))
      );
    if (acknowledgmentInsert.error) {
      logger.error("Failed to record sales rule acknowledgments", {
        error: acknowledgmentInsert.error
      });
    }
  }

  if (d.methodType === "Purchase to Order") {
    const quantities = d.quantity ?? [1];
    const priceResult = await resolvePurchaseToOrderPrices(
      serviceRole,
      companyId,
      quoteId,
      quoteLineId,
      quantities,
      userId
    );
    if (priceResult?.error) {
      throw redirect(
        path.to.quoteLine(quoteId, quoteLineId),
        await flash(
          request,
          error(priceResult.error, "Failed to resolve Purchase to Order prices")
        )
      );
    }
  }

  if (d.methodType === "Pull from Inventory") {
    const quantities = d.quantity ?? [1];
    const priceResult = await resolveQuoteLinePrices(
      serviceRole,
      companyId,
      quoteId,
      quoteLineId,
      quantities,
      userId
    );
    if (priceResult?.error) {
      throw redirect(
        path.to.quoteLine(quoteId, quoteLineId),
        await flash(
          request,
          error(
            priceResult.error,
            "Failed to resolve Pull from Inventory prices"
          )
        )
      );
    }
  }

  if (d.methodType === "Make to Order") {
    const upsertMethod = await upsertQuoteLineMethod(serviceRole, {
      quoteId,
      quoteLineId,
      itemId: d.itemId,
      configuration,
      companyId,
      userId
    });

    if (upsertMethod.error) {
      throw redirect(
        path.to.quoteLine(quoteId, quoteLineId),
        await flash(
          request,
          error(upsertMethod.error, "Failed to create quote line method.")
        )
      );
    }
    const recalcResult = await recalculateQuoteLinePrices(
      serviceRole,
      quoteId,
      quoteLineId,
      userId
    );
    if (recalcResult?.error) {
      throw redirect(
        path.to.quoteLine(quoteId, quoteLineId),
        await flash(
          request,
          error(recalcResult.error, "Failed to recalculate quote line prices")
        )
      );
    }
  }

  throw redirect(path.to.quoteLine(quoteId, quoteLineId));
}
