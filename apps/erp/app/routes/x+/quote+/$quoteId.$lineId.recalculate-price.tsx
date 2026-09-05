import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { upsertQuoteLinePrices } from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "quoteid-lineid-recalculate-price");

const numberArrayValidator = z.array(z.number());

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  const unitPricesByQuantity = numberArrayValidator.safeParse(
    JSON.parse((formData.get("unitPricesByQuantity") ?? "[]") as string)
  );

  const quantities = numberArrayValidator.safeParse(
    JSON.parse((formData.get("quantities") ?? "[]") as string)
  );

  const categoryMarkupsByQuantityValidator = z.record(
    z.string(),
    z.record(z.string(), z.number().min(0))
  );
  const categoryMarkupsByQuantity =
    categoryMarkupsByQuantityValidator.safeParse(
      JSON.parse((formData.get("categoryMarkupsByQuantity") as string) ?? "{}")
    );

  if (unitPricesByQuantity.success === false) {
    return data(
      { data: null, errors: unitPricesByQuantity.error.issues?.[0].message },
      { status: 400 }
    );
  }

  if (quantities.success === false) {
    return data(
      { data: null, errors: quantities.error.issues?.[0].message },
      { status: 400 }
    );
  }

  if (categoryMarkupsByQuantity.success === false) {
    return data(
      { data: null, errors: "Invalid category markups" },
      { status: 400 }
    );
  }

  if (unitPricesByQuantity.data.length !== quantities.data.length) {
    return data(
      { data: null, errors: "Prices and quantities must have the same length" },
      { status: 400 }
    );
  }

  const inserts = unitPricesByQuantity.data.map((unitPrice, index) => {
    const quantity = quantities.data[index];
    const markups = categoryMarkupsByQuantity.data[quantity];
    return {
      quoteLineId: lineId,
      quantity,
      unitPrice,
      createdBy: userId,
      // discountPercent / leadTime / shippingCost are intentionally omitted so
      // upsertQuoteLinePrices preserves the user-entered values for each quantity
      // — a recalc only recomputes the unit price.
      categoryMarkups: markups ?? undefined,
      // Applying a markup is explicit cost-plus intent: that row goes back to
      // system pricing so future BOM changes reprice it. A quantity with no
      // markup omits priceSource, so a manual row keeps its manual source.
      ...(markups !== undefined ? { priceSource: "system" as const } : {})
    };
  });

  try {
    await upsertQuoteLinePrices(
      getDatabaseClient(),
      companyId,
      quoteId,
      lineId,
      inserts
    );
  } catch (err) {
    logger.error("Failed to recalculate quote line prices", { error: err });
    return data(
      { data: null, error: "Failed to recalculate quote line prices" },
      { status: 400 }
    );
  }

  return { data: null, error: null };
}
