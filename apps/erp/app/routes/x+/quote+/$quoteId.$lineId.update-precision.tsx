import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  updateQuoteLinePrecision,
  upsertQuoteLinePrices
} from "~/modules/sales";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client } = await requirePermissions(request, {
    update: "sales"
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  const precision = Number(formData.get("precision") ?? 2);

  const updatePrecision = await updateQuoteLinePrecision(lineId, precision);
  if (updatePrecision.error) {
    return data(
      { data: null, error: updatePrecision.error.message },
      { status: 400 }
    );
  }

  // Update all the prices for the quote line to reflect the new precision
  const prices = await client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteLineId", lineId);

  if (prices.data) {
    const roundedPrices = prices.data?.map((price) => ({
      quoteLineId: price.quoteLineId,
      unitPrice: Number(price.unitPrice.toFixed(precision)),
      leadTime: price.leadTime,
      discountPercent: price.discountPercent,
      quantity: price.quantity,
      createdBy: price.createdBy
    }));

    const updatePrices = await upsertQuoteLinePrices(
      quoteId,
      lineId,
      roundedPrices
    );
    if (updatePrices.error) {
      return data(
        { data: null, error: updatePrices.error.message },
        { status: 400 }
      );
    }
  }

  return { data: null, error: null };
}
