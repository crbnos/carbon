import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import { upsertQuoteLinePrices } from "~/modules/sales";

const numberArrayValidator = z.array(z.number());

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  const markup = Number.parseInt((formData.get("markup") as string) ?? "15");
  const unitCostsByQuantity = numberArrayValidator.safeParse(
    JSON.parse((formData.get("unitCostsByQuantity") ?? "[]") as string)
  );

  const quantities = numberArrayValidator.safeParse(
    JSON.parse((formData.get("quantities") ?? "[]") as string)
  );

  if (unitCostsByQuantity.success === false) {
    return json(
      { data: null, errors: unitCostsByQuantity.error.errors?.[0].message },
      { status: 400 }
    );
  }

  if (quantities.success === false) {
    return json(
      { data: null, errors: quantities.error.errors?.[0].message },
      { status: 400 }
    );
  }

  const inserts = unitCostsByQuantity.data.map((unitCost, index) => ({
    quoteLineId: lineId,
    quantity: quantities.data[index],
    unitPrice: unitCost * (1 + markup / 100),
    discountPercent: 0,
    leadTime: 0,
    createdBy: userId,
  }));

  const insertLinePrices = await upsertQuoteLinePrices(
    client,
    quoteId,
    lineId,
    inserts
  );
  if (insertLinePrices.error) {
    return json(
      { data: null, error: insertLinePrices.error.message },
      { status: 400 }
    );
  }

  return json({ data: null, error: null });
}
