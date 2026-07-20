import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
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
