import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { upsertQuoteLinePrices } from "~/modules/sales";

const logger = getLogger("erp", "quoteid-lineid-recalculate-price");

const numberArrayValidator = z.array(z.number());

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client, userId } = await requirePermissions(request, {
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
    z.record(z.number().min(0))
  );
  const categoryMarkupsByQuantity =
    categoryMarkupsByQuantityValidator.safeParse(
      JSON.parse((formData.get("categoryMarkupsByQuantity") as string) ?? "{}")
    );

  if (unitPricesByQuantity.success === false) {
    return data(
      { data: null, errors: unitPricesByQuantity.error.errors?.[0].message },
      { status: 400 }
    );
  }

  if (quantities.success === false) {
    return data(
      { data: null, errors: quantities.error.errors?.[0].message },
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
    return {
      quoteLineId: lineId,
      quantity,
      unitPrice,
      discountPercent: 0,
      leadTime: 0,
      createdBy: userId,
      categoryMarkups: categoryMarkupsByQuantity.data[quantity] ?? undefined
    };
  });

  const insertLinePrices = await upsertQuoteLinePrices(
    client,
    quoteId,
    lineId,
    inserts
  );
  if (insertLinePrices.error) {
    logger.error(insertLinePrices.error);
    return data(
      { data: null, error: insertLinePrices.error.message },
      { status: 400 }
    );
  }

  return { data: null, error: null };
}
